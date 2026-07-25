import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { requireUser, type AuthContext } from "@/lib/auth/authorization";
import { requireCheckoutPricingConfig, requireHmacSecret } from "@/lib/env.server";
import { ApiError } from "@/lib/http/problem";
import { logger } from "@/lib/observability/logger";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { enqueueEmail } from "@/features/email/service";
import type { CheckoutConfirmationInput, CheckoutStartInput, CheckoutVerifyInput } from "@/features/checkout/schemas";
import { razorpayWebhookSchema } from "@/features/checkout/schemas";
import { resolveOfferPrices } from "@/features/offers/pricing";
import { mapOrderDetailRow, ORDER_DETAIL_SELECT, type MyOrderDetailDTO } from "@/features/customer-orders/dto";
import { processRefundWebhookEvent } from "@/features/refunds/service";
import {
  captureRazorpayPayment,
  createRazorpayOrder,
  createRazorpayRefund,
  fetchRazorpayPayment,
  getRazorpayPublicConfig,
  getRazorpaySecret,
  verifyRazorpayPaymentSignature,
  WEBHOOK_TIMEOUT_MS,
  type RazorpayPayment,
} from "@/features/checkout/razorpay";

type RawProduct = {
  id: string;
  slug: string;
  name: string;
  base_price_cents: number;
  sale_price_cents: number | null;
  currency: string;
  status: string;
  deleted_at: string | null;
};

type RawColor = { name: string; slug: string };
type RawVariant = {
  id: string;
  product_id: string;
  sku: string;
  stock_quantity: number;
  is_active: boolean;
  deleted_at: string | null;
  sort_order: number;
  colors: RawColor | RawColor[];
};

type ResolvedLine = {
  productId: string;
  productVariantId: string;
  productSlug: string;
  productName: string;
  color: string;
  sku: string;
  quantity: number;
  listUnitPriceMinor: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
};

export type CheckoutRecord = {
  id: string;
  status: "creating_payment" | "payment_pending" | "completed" | "failed" | "expired" | "requires_review";
  guest_token_hash: string;
  currency: string;
  total_minor: number;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  order_id: string | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  reservation_expires_at: string;
};

function one<T>(value: T | T[]) {
  return Array.isArray(value) ? value[0] : value;
}

function tokenHash(token: string) {
  return createHmac("sha256", requireHmacSecret()).update(token).digest("hex");
}

function tokenMatches(token: string, expectedHash: string) {
  const supplied = Buffer.from(tokenHash(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function colorMatches(color: RawColor, requested?: string) {
  if (!requested) return true;
  const normalized = requested.trim().toLowerCase();
  return color.name.toLowerCase() === normalized || color.slug.toLowerCase() === normalized;
}

async function resolveCheckoutLines(input: CheckoutStartInput) {
  const admin = createAdminSupabaseClient();
  const slugs = [...new Set(input.items.map((item) => item.productSlug))];
  const { data: productRows, error: productsError } = await admin
    .from("products")
    .select("id,slug,name,base_price_cents,sale_price_cents,currency,status,deleted_at")
    .in("slug", slugs)
    .eq("status", "published")
    .is("deleted_at", null);
  if (productsError) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Products could not be validated for checkout.");

  const products = new Map((productRows ?? []).map((row) => [row.slug, row as RawProduct]));
  if (products.size !== slugs.length) throw new ApiError(422, "PRODUCT_UNAVAILABLE", "One or more products are no longer available.");

  const productIds = [...products.values()].map((product) => product.id);
  // Re-priced here rather than trusted from the browser, same as base_price_cents/
  // sale_price_cents above: this is the money authority (RZ-030's trust boundary),
  // so an offer that expired between page load and checkout can never be charged.
  const [{ data: variantRows, error: variantsError }, offers] = await Promise.all([
    admin
      .from("product_variants")
      .select("id,product_id,sku,stock_quantity,is_active,deleted_at,sort_order,colors(name,slug)")
      .in("product_id", productIds)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true }),
    resolveOfferPrices(productIds),
  ]);
  if (variantsError) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Product options could not be validated for checkout.");

  const variantsByProduct = new Map<string, RawVariant[]>();
  for (const row of (variantRows ?? []) as unknown as RawVariant[]) {
    const rows = variantsByProduct.get(row.product_id) ?? [];
    rows.push(row);
    variantsByProduct.set(row.product_id, rows);
  }

  const linesByVariant = new Map<string, ResolvedLine>();
  let currency: string | null = null;
  for (const requested of input.items) {
    const product = products.get(requested.productSlug);
    if (!product) throw new ApiError(422, "PRODUCT_UNAVAILABLE", `Product ${requested.productSlug} is unavailable.`);
    if (currency && currency !== product.currency) throw new ApiError(422, "MIXED_CURRENCY_CART", "All checkout items must use the same currency.");
    currency = product.currency;

    const variant = (variantsByProduct.get(product.id) ?? []).find((candidate) => {
      const color = one(candidate.colors);
      return color && colorMatches(color, requested.color);
    });
    if (!variant) throw new ApiError(422, "VARIANT_UNAVAILABLE", `The selected option for ${product.name} is unavailable.`);
    const color = one(variant.colors);
    const existing = linesByVariant.get(variant.id);
    const quantity = (existing?.quantity ?? 0) + requested.quantity;
    if (quantity > 99) throw new ApiError(422, "QUANTITY_INVALID", `The quantity for ${product.name} cannot exceed 99.`);
    const unitPrice = offers.get(product.id)?.offerPriceCents ?? product.sale_price_cents ?? product.base_price_cents;
    linesByVariant.set(variant.id, {
      productId: product.id,
      productVariantId: variant.id,
      productSlug: product.slug,
      productName: product.name,
      color: color.name,
      sku: variant.sku,
      quantity,
      listUnitPriceMinor: product.base_price_cents,
      unitPriceMinor: unitPrice,
      lineTotalMinor: unitPrice * quantity,
    });
  }

  const lines = [...linesByVariant.values()];
  const subtotalMinor = lines.reduce((sum, line) => sum + line.listUnitPriceMinor * line.quantity, 0);
  const merchandiseMinor = lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);
  const discountMinor = subtotalMinor - merchandiseMinor;
  // Validated at boot by lib/env.server.ts#requireCheckoutPricingConfig and required
  // in production, so a missing value can no longer silently ship orders for free.
  const { freeShippingThresholdMinor, flatShippingMinor } = requireCheckoutPricingConfig();
  const shippingMinor = merchandiseMinor >= freeShippingThresholdMinor ? 0 : flatShippingMinor;
  const taxMinor = 0;
  return {
    lines,
    currency: currency ?? "INR",
    subtotalMinor,
    discountMinor,
    shippingMinor,
    taxMinor,
    totalMinor: subtotalMinor - discountMinor + shippingMinor + taxMinor,
  };
}

async function releaseCheckout(checkoutId: string, target: "failed" | "expired") {
  const admin = createAdminSupabaseClient();
  await admin.rpc("release_checkout_inventory", { p_checkout_session_id: checkoutId, p_target_status: target });
}

function mapInventoryError(message: string) {
  if (message.includes("INSUFFICIENT_STOCK")) return new ApiError(409, "INSUFFICIENT_STOCK", "An item sold out or no longer has the requested quantity.");
  if (message.includes("CHECKOUT_EMPTY")) return new ApiError(422, "EMPTY_CART", "Your cart is empty.");
  return new ApiError(503, "SERVICE_UNAVAILABLE", "Inventory could not be reserved.");
}

// RZ-045 / RZ-000 decision #26: checkout requires login. requireUser() runs first
// (not in parallel with cart resolution) so an unauthenticated request is
// rejected before any cart/pricing work happens. Guest browsing and carts are
// untouched -- only the purchase step is gated; proxy.ts gates the /checkout
// page itself the same way.
export async function startRazorpayCheckout(input: CheckoutStartInput, authContext?: AuthContext) {
  // The route already resolves the caller to key its rate limiter; accepting that
  // context avoids validating the same token twice per checkout start. It stays
  // optional so every other caller keeps the original, self-contained behaviour.
  const auth = authContext ?? (await requireUser());
  const resolved = await resolveCheckoutLines(input);
  if (resolved.totalMinor < 100) throw new ApiError(422, "ORDER_TOTAL_TOO_LOW", "The order total is below the payment provider minimum.");

  const admin = createAdminSupabaseClient();
  const checkoutToken = randomBytes(32).toString("base64url");
  const reservationExpiresAt = new Date(Date.now() + 20 * 60_000).toISOString();

  // Links the session to the shopper's active cart so complete_razorpay_checkout can
  // mark it 'converted' in the same transaction as the order. Without this the cart
  // was only ever cleared by a client-side call, so a closed tab (or a webhook-only
  // completion) left the just-purchased items sitting in the bag, inviting a
  // duplicate purchase. Checkout is login-gated, so the user's cart is the only one.
  const { data: activeCart } = await admin
    .from("carts")
    .select("id")
    .eq("user_id", auth.userId)
    .eq("status", "active")
    .maybeSingle();

  const { data: session, error: sessionError } = await admin.from("checkout_sessions").insert({
    user_id: auth.userId,
    cart_id: activeCart?.id ?? null,
    guest_token_hash: tokenHash(checkoutToken),
    customer_name: input.customer.name,
    customer_email: input.customer.email,
    customer_phone: input.customer.phone,
    shipping_address: input.shippingAddress,
    billing_address: input.billingAddress ?? null,
    terms_accepted_at: new Date().toISOString(),
    customer_note: input.customerNote || null,
    currency: resolved.currency,
    subtotal_minor: resolved.subtotalMinor,
    discount_minor: resolved.discountMinor,
    shipping_minor: resolved.shippingMinor,
    tax_minor: resolved.taxMinor,
    total_minor: resolved.totalMinor,
    reservation_expires_at: reservationExpiresAt,
  }).select("id").single();
  if (sessionError || !session) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Checkout could not be started.");

  const itemInsert = await admin.from("checkout_session_items").insert(resolved.lines.map((line) => ({
    checkout_session_id: session.id,
    product_id: line.productId,
    product_variant_id: line.productVariantId,
    product_name: line.productName,
    sku: line.sku,
    quantity: line.quantity,
    list_unit_price_minor: line.listUnitPriceMinor,
    unit_price_minor: line.unitPriceMinor,
    line_total_minor: line.lineTotalMinor,
  })));
  if (itemInsert.error) {
    await admin.from("checkout_sessions").delete().eq("id", session.id);
    throw new ApiError(503, "SERVICE_UNAVAILABLE", "Checkout items could not be saved.");
  }

  const reservation = await admin.rpc("reserve_checkout_inventory", { p_checkout_session_id: session.id });
  if (reservation.error) {
    await admin.from("checkout_sessions").delete().eq("id", session.id);
    throw mapInventoryError(reservation.error.message);
  }

  const receipt = `cd_${session.id.replaceAll("-", "")}`;
  let providerOrder: Awaited<ReturnType<typeof createRazorpayOrder>>;
  try {
    providerOrder = await createRazorpayOrder({
      amount: resolved.totalMinor,
      currency: resolved.currency,
      receipt,
      checkoutId: session.id,
    });
  } catch (error) {
    await releaseCheckout(session.id, "failed");
    throw error;
  }

  const update = await admin.from("checkout_sessions").update({
    status: "payment_pending",
    razorpay_order_id: providerOrder.id,
  }).eq("id", session.id).eq("status", "creating_payment");
  if (update.error) {
    await releaseCheckout(session.id, "failed");
    throw new ApiError(503, "SERVICE_UNAVAILABLE", "Checkout could not be connected to the payment provider.");
  }
  await admin.from("payment_attempts").insert({
    checkout_session_id: session.id,
    provider: "razorpay",
    provider_order_id: providerOrder.id,
    status: "created",
    amount_minor: resolved.totalMinor,
    currency: resolved.currency,
  });

  const { data: settings } = await admin.from("store_settings").select("store_name").eq("singleton", true).maybeSingle();
  const publicConfig = getRazorpayPublicConfig();
  return {
    checkoutId: session.id,
    checkoutToken,
    expiresAt: reservationExpiresAt,
    items: resolved.lines.map((line) => ({
      productSlug: line.productSlug,
      name: line.productName,
      color: line.color,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      lineTotalMinor: line.lineTotalMinor,
    })),
    summary: {
      currency: resolved.currency,
      subtotalMinor: resolved.subtotalMinor,
      discountMinor: resolved.discountMinor,
      shippingMinor: resolved.shippingMinor,
      taxMinor: resolved.taxMinor,
      totalMinor: resolved.totalMinor,
    },
    razorpay: {
      keyId: publicConfig.keyId,
      mode: publicConfig.mode,
      orderId: providerOrder.id,
      amount: resolved.totalMinor,
      currency: resolved.currency,
      name: settings?.store_name || "Cherry Doodle",
      description: `Checkout ${receipt}`,
      prefill: { name: input.customer.name, email: input.customer.email, contact: input.customer.phone },
    },
  };
}

async function loadCheckout(checkoutId: string) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.from("checkout_sessions").select("*").eq("id", checkoutId).maybeSingle();
  if (error || !data) throw new ApiError(404, "CHECKOUT_NOT_FOUND", "Checkout session not found.");
  return data as CheckoutRecord;
}

async function completedOrder(orderId: string) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.from("orders").select("id,order_number,status,payment_status,total_minor,currency,placed_at").eq("id", orderId).single();
  if (error || !data) throw new ApiError(503, "SERVICE_UNAVAILABLE", "The completed order could not be loaded.");
  return {
    id: data.id,
    orderNumber: data.order_number,
    status: data.status,
    paymentStatus: data.payment_status,
    totalMinor: data.total_minor,
    currency: data.currency,
    placedAt: data.placed_at,
  };
}

// A captured payment that could not become an order is a money-affecting incident,
// not routine traffic. These surface to callers as 409s, and handleRoute only
// reports 5xx to Sentry, so they are escalated explicitly here instead of being
// visible only to whoever happens to read the review queue.
async function alertPaymentIncident(event: string, fields: Record<string, unknown>) {
  logger.error(event, fields);
  if (process.env.VITEST) return;
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureMessage(event, { level: "error", tags: { area: "payments" }, extra: fields });
  } catch {
    // Telemetry must never change a payment outcome.
  }
}

async function markCapturedPaymentForReview(session: CheckoutRecord, payment: RazorpayPayment, reason: string) {
  const admin = createAdminSupabaseClient();
  await admin.from("payment_attempts").upsert({
    checkout_session_id: session.id,
    provider: "razorpay",
    provider_order_id: session.razorpay_order_id,
    provider_payment_id: payment.id,
    status: "captured",
    amount_minor: payment.amount,
    currency: payment.currency,
    method: payment.method,
    metadata: { requiresReviewReason: reason.slice(0, 500) },
  }, { onConflict: "provider,provider_payment_id" });
  await admin.from("checkout_sessions").update({ status: "requires_review", razorpay_payment_id: payment.id }).eq("id", session.id).neq("status", "completed");

  await alertPaymentIncident("payment_requires_review", {
    checkoutSessionId: session.id,
    razorpayPaymentId: payment.id,
    amountMinor: payment.amount,
    currency: payment.currency,
    reason: reason.slice(0, 300),
  });
  // The customer's money has left their account; silence is the worst response.
  await enqueueEmail("payment_requires_review", session.customer_email, {
    customerName: session.customer_name,
    amountMinor: payment.amount,
    currency: payment.currency,
    razorpayPaymentId: payment.id,
  });
}

/**
 * Guarantees the payment is captured before any order is created.
 *
 * Auto-capture is a Razorpay Dashboard setting that the Orders API cannot force, so
 * an `authorized` payment is captured here explicitly. Without this, an account with
 * auto-capture disabled would authorize every payment, create no orders, and have
 * Razorpay auto-refund the customer days later — with nothing in our logs to say so.
 */
async function ensureCaptured(session: CheckoutRecord, payment: RazorpayPayment): Promise<RazorpayPayment> {
  if (payment.status === "captured" && payment.captured === true) return payment;
  if (payment.status !== "authorized") {
    throw new ApiError(409, "PAYMENT_NOT_CAPTURED", "Payment is not captured yet.");
  }

  try {
    const captured = await captureRazorpayPayment(payment.id, session.total_minor, session.currency);
    if (captured.status === "captured" && captured.captured === true) return captured;
  } catch (error) {
    // "already captured" is the expected error when the account's own auto-capture
    // won the race, so the authoritative re-fetch below settles it either way.
    logger.warn("razorpay_capture_attempt_failed", {
      checkoutSessionId: session.id,
      razorpayPaymentId: payment.id,
      errorMessage: error instanceof Error ? error.message.slice(0, 200) : "unknown",
    });
  }

  const refreshed = await fetchRazorpayPayment(payment.id);
  if (refreshed.status === "captured" && refreshed.captured === true) return refreshed;
  throw new ApiError(409, "PAYMENT_NOT_CAPTURED", "Payment is not captured yet.");
}

/**
 * Refunds a capture we can never fulfil (the reservation lapsed and the stock is
 * gone), rather than parking the customer's money in a manual queue indefinitely.
 * The idempotency key is the checkout session id, so a retried webhook or a rerun
 * of the reconciliation job cannot issue a second refund for the same checkout.
 */
async function autoRefundUnfulfillableCapture(session: CheckoutRecord, payment: RazorpayPayment, reason: string): Promise<never> {
  const admin = createAdminSupabaseClient();
  try {
    await createRazorpayRefund({
      paymentId: payment.id,
      amount: payment.amount,
      idempotencyKey: `checkout-unfulfillable:${session.id}`,
      notes: { checkout_id: session.id, reason: "checkout_unfulfillable" },
    });
  } catch (error) {
    await markCapturedPaymentForReview(session, payment, `Auto-refund failed: ${error instanceof Error ? error.message : "unknown"}`);
    throw new ApiError(409, "PAYMENT_REQUIRES_REVIEW", "Payment was captured, but the order needs manual review. Please contact support.");
  }

  await admin.from("payment_attempts").upsert({
    checkout_session_id: session.id,
    provider: "razorpay",
    provider_order_id: session.razorpay_order_id,
    provider_payment_id: payment.id,
    status: "refunded",
    amount_minor: payment.amount,
    currency: payment.currency,
    method: payment.method,
    metadata: { autoRefundReason: reason.slice(0, 500) },
  }, { onConflict: "provider,provider_payment_id" });
  await admin.from("checkout_sessions").update({ razorpay_payment_id: payment.id }).eq("id", session.id).neq("status", "completed");

  await alertPaymentIncident("payment_auto_refunded", {
    checkoutSessionId: session.id,
    razorpayPaymentId: payment.id,
    amountMinor: payment.amount,
    currency: payment.currency,
    reason: reason.slice(0, 300),
  });
  await enqueueEmail("payment_auto_refunded", session.customer_email, {
    customerName: session.customer_name,
    amountMinor: payment.amount,
    currency: payment.currency,
    razorpayPaymentId: payment.id,
  });

  throw new ApiError(409, "PAYMENT_AUTO_REFUNDED", "That checkout had already expired, so the payment was refunded in full. Please start a new order.");
}

// Exported so the admin retry action and the reconciliation sync job reuse this
// exact capture-to-order logic instead of duplicating it — both simply call it
// again with a freshly re-fetched payment.
export async function finalizeCapturedPayment(session: CheckoutRecord, payment: RazorpayPayment) {
  if (session.status === "completed" && session.order_id) return completedOrder(session.order_id);
  if (!session.razorpay_order_id || payment.order_id !== session.razorpay_order_id) throw new ApiError(409, "PAYMENT_ORDER_MISMATCH", "The payment does not belong to this checkout.");
  if (payment.amount !== session.total_minor || payment.currency.toUpperCase() !== session.currency) throw new ApiError(409, "PAYMENT_AMOUNT_MISMATCH", "The captured payment amount does not match the checkout total.");

  const admin = createAdminSupabaseClient();
  const capturedPayment = await ensureCaptured(session, payment);

  // The money is now definitely ours to account for. If a payment.failed webhook or
  // the expiry sweeper already took this session out of 'payment_pending' -- the
  // customer retried after a decline, or finished a slow bank flow late -- ask the
  // database to put it back into a completable state before giving up on it.
  if (session.status !== "payment_pending") {
    const { data: reclaimed, error: reclaimError } = await admin.rpc("reclaim_checkout_for_capture", {
      p_checkout_session_id: session.id,
    });
    if (reclaimError || reclaimed !== true) {
      return autoRefundUnfulfillableCapture(
        session,
        capturedPayment,
        reclaimError?.message || `Checkout was '${session.status}' and its stock could not be re-reserved.`,
      );
    }
  }

  const capturedAt = new Date(capturedPayment.created_at * 1000).toISOString();
  const { data: orderId, error } = await admin.rpc("complete_razorpay_checkout", {
    p_checkout_session_id: session.id,
    p_provider_payment_id: capturedPayment.id,
    p_payment_method: capturedPayment.method || "unknown",
    p_captured_at: capturedAt,
  });
  if (error || !orderId) {
    await markCapturedPaymentForReview(session, capturedPayment, error?.message || "Order conversion failed");
    throw new ApiError(409, "PAYMENT_REQUIRES_REVIEW", "Payment was captured, but the order needs manual review. Please contact support.");
  }
  return completedOrder(String(orderId));
}

export async function verifyAndCompleteRazorpayCheckout(input: CheckoutVerifyInput) {
  const session = await loadCheckout(input.checkoutId);
  if (!tokenMatches(input.checkoutToken, session.guest_token_hash)) throw new ApiError(404, "CHECKOUT_NOT_FOUND", "Checkout session not found.");
  if (session.status === "completed" && session.order_id) return completedOrder(session.order_id);
  // A 'failed' or 'expired' session is deliberately NOT rejected here any more. The
  // customer may have retried inside the Razorpay modal after a decline, or finished
  // a slow bank flow after the reservation lapsed; in both cases real money moved.
  // The signature check below and finalizeCapturedPayment's reclaim/refund handling
  // decide the outcome from the provider's own record, not from our stale status.
  if (!session.razorpay_order_id || input.razorpayOrderId !== session.razorpay_order_id) throw new ApiError(409, "PAYMENT_ORDER_MISMATCH", "The payment does not belong to this checkout.");
  if (!verifyRazorpayPaymentSignature(session.razorpay_order_id, input.razorpayPaymentId, input.razorpaySignature, getRazorpaySecret())) {
    throw new ApiError(400, "PAYMENT_SIGNATURE_INVALID", "Payment verification failed.");
  }
  const payment = await fetchRazorpayPayment(input.razorpayPaymentId);
  return finalizeCapturedPayment(session, payment);
}

/**
 * Releases a checkout the shopper walked away from (they closed the Razorpay modal
 * or left the page). Without this the reservation sat until the 20-minute sweep, so
 * a shopper retrying immediately could be told their own held stock was sold out.
 *
 * Safe against a payment that completes anyway: a later capture goes through
 * finalizeCapturedPayment, which re-reserves the stock it just freed (or refunds).
 * Authorized by the same capability token pair as /verify, so it cannot be used to
 * cancel someone else's checkout.
 */
export async function cancelRazorpayCheckout(input: CheckoutConfirmationInput) {
  const session = await loadCheckout(input.checkoutId);
  if (!tokenMatches(input.checkoutToken, session.guest_token_hash)) {
    throw new ApiError(404, "CHECKOUT_NOT_FOUND", "Checkout session not found.");
  }
  if (session.status !== "payment_pending" && session.status !== "creating_payment") {
    return { released: false, status: session.status };
  }
  const { error } = await createAdminSupabaseClient().rpc("release_checkout_inventory", {
    p_checkout_session_id: session.id,
    p_target_status: "failed",
  });
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "The checkout could not be released.");
  return { released: true, status: "failed" as const };
}

async function recordFailedPayment(session: CheckoutRecord, payment: RazorpayPayment) {
  const admin = createAdminSupabaseClient();

  // Guard against an out-of-order/stale payment.failed event overwriting a
  // payment_attempts row that a payment.captured event already recorded as
  // captured/refunded for this exact provider payment id. Once Razorpay has
  // reported a capture, a later "failed" delivery for the same payment id cannot
  // retroactively make it un-captured.
  const { data: existing } = await admin
    .from("payment_attempts")
    .select("status")
    .eq("provider", "razorpay")
    .eq("provider_payment_id", payment.id)
    .maybeSingle();
  if (existing && (existing.status === "captured" || existing.status === "refunded")) return;

  await admin.from("payment_attempts").upsert({
    checkout_session_id: session.id,
    provider: "razorpay",
    provider_order_id: session.razorpay_order_id,
    provider_payment_id: payment.id,
    status: "failed",
    amount_minor: payment.amount,
    currency: payment.currency,
    method: payment.method,
    error_code: payment.error_code?.slice(0, 100) || null,
    error_description: payment.error_description?.slice(0, 1000) || null,
  }, { onConflict: "provider,provider_payment_id" });

  // A failed attempt must NOT end the checkout while the reservation is still live.
  // Razorpay Checkout lets the customer retry in the same modal against the same
  // razorpay_order_id after a decline or a wrong OTP; releasing the stock and marking
  // the session 'failed' here used to make that successful retry uncompletable, so
  // the money was captured and the order never created. The stock is only freed once
  // the reservation window has actually closed (the checkout-cleanup job sweeps the
  // rest), keeping the session payable for as long as the customer can still pay.
  if (new Date(session.reservation_expires_at).getTime() > Date.now()) {
    logger.info("payment_failed_retry_window_open", {
      checkoutSessionId: session.id,
      razorpayPaymentId: payment.id,
      reservationExpiresAt: session.reservation_expires_at,
    });
    return;
  }

  const release = await admin.rpc("release_checkout_inventory", { p_checkout_session_id: session.id, p_target_status: "failed" });
  if (release.error) logger.error("checkout_inventory_release_failed", { checkoutSessionId: session.id, errorMessage: release.error.message });
}

async function auditWebhookEvent(eventType: string, providerId: string | null, requestId: string) {
  const { error } = await createAdminSupabaseClient().from("audit_logs").insert({
    actor_user_id: null,
    actor_role: null,
    action: `webhook.${eventType}`,
    resource_type: "payment_event",
    resource_id: null,
    before_data: null,
    after_data: { providerId },
    request_id: requestId,
  });
  if (error) logger.error("webhook_audit_write_failed", { eventType, requestId, errorCode: error.code });
}

export async function processRazorpayWebhook(rawBody: string, eventId: string | null, requestId: string) {
  const payloadHash = createHash("sha256").update(rawBody).digest("hex");

  // The signature has already been verified, so this body genuinely came from
  // Razorpay. Anything we simply do not model (a new event type, a payload shape
  // our schema is stricter than) is acknowledged rather than rejected: returning a
  // non-2xx would make Razorpay retry it forever and eventually disable the endpoint.
  let event: ReturnType<typeof razorpayWebhookSchema.parse>;
  try {
    const parsed = razorpayWebhookSchema.safeParse(JSON.parse(rawBody));
    if (!parsed.success) {
      logger.warn("razorpay_webhook_unmodelled", { requestId, eventId, payloadHash });
      return { received: true, duplicate: false, handled: false };
    }
    event = parsed.data;
  } catch {
    logger.warn("razorpay_webhook_unparsable_json", { requestId, eventId, payloadHash });
    return { received: true, duplicate: false, handled: false };
  }

  const admin = createAdminSupabaseClient();
  // Deduplicate on the SIGNED bytes, not on `x-razorpay-event-id`. That header sits
  // outside the HMAC, so a header-keyed guard could be bypassed by replaying a
  // captured, validly-signed body with a fresh random id — forcing unbounded
  // reprocessing, and with it unbounded outbound Razorpay API calls. The hash of the
  // exact delivered body is the only replay-proof key available, and a genuine
  // Razorpay retry resends that body byte-for-byte.
  const eventKey = `razorpay:${payloadHash}`;

  const claim = await admin.from("webhook_events").insert({
    provider: "razorpay",
    event_key: eventKey,
    payload_hash: payloadHash,
    status: "received",
  });

  let attempts = 1;
  if (claim.error?.code === "23505") {
    // An event with this id was already recorded. Only a row already marked
    // 'processed' is a genuine duplicate to skip. A 'received' row (the process
    // crashed mid-flight) or a 'failed' row (a transient error) means this
    // Razorpay retry should be allowed to actually reprocess the event -- every
    // side effect below is itself idempotent (finalizeCapturedPayment,
    // recordFailedPayment, mark_refund_processed all safely no-op or re-apply),
    // so re-running is safe and is how a lost/failed webhook recovers (H7).
    const { data: existing, error: lookupError } = await admin.from("webhook_events").select("status,attempts").eq("event_key", eventKey).maybeSingle();
    if (lookupError || !existing) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Webhook deduplication is unavailable.");
    if (existing.status === "processed") return { received: true, duplicate: true, handled: true };
    attempts = existing.attempts + 1;
  } else if (claim.error) {
    throw new ApiError(503, "SERVICE_UNAVAILABLE", "Webhook deduplication is unavailable.");
  }

  try {
    const entity = event.payload.payment?.entity;
    const refundEntity = event.payload.refund?.entity;
    let handled = true;
    // `payment.authorized` is handled alongside the capture events: the payment is
    // re-fetched and finalizeCapturedPayment captures it explicitly if the account's
    // auto-capture did not. Without it, an account with auto-capture off would leave
    // every payment authorized until Razorpay auto-refunded it.
    if ((event.event === "payment.captured" || event.event === "order.paid" || event.event === "payment.authorized") && entity) {
      // Tighter timeout than an interactive request: this runs while Razorpay is
      // still waiting on the webhook response, and blowing its ~5s deadline causes
      // retry storms and eventually endpoint deactivation. A timeout here surfaces
      // as a 503, which is exactly the case where a Razorpay retry is wanted.
      const payment = await fetchRazorpayPayment(entity.id, { timeoutMs: WEBHOOK_TIMEOUT_MS });
      if (payment.order_id) {
        const { data: session } = await admin.from("checkout_sessions").select("*").eq("razorpay_order_id", payment.order_id).maybeSingle();
        if (session) await finalizeCapturedPayment(session as CheckoutRecord, payment);
      }
    } else if (event.event === "payment.failed" && entity?.order_id) {
      const { data: session } = await admin.from("checkout_sessions").select("*").eq("razorpay_order_id", entity.order_id).maybeSingle();
      if (session) await recordFailedPayment(session as CheckoutRecord, entity as unknown as RazorpayPayment);
    } else if (event.event.startsWith("refund.") && refundEntity) {
      await processRefundWebhookEvent(refundEntity);
    } else if (event.event.startsWith("payment.dispute.")) {
      // Chargebacks carry a hard response deadline and direct financial exposure.
      // There is no dispute table yet, so the durable record is the audit_logs row
      // written below plus an explicit alert — never a silent 200.
      await alertPaymentIncident("payment_dispute_event", {
        event: event.event,
        razorpayPaymentId: entity?.id ?? null,
        amountMinor: entity?.amount ?? null,
        requestId,
      });
    } else {
      handled = false;
    }
    await admin.from("webhook_events").update({ status: "processed", processed_at: new Date().toISOString(), attempts, last_error: null }).eq("event_key", eventKey);
    await auditWebhookEvent(event.event, entity?.id ?? refundEntity?.id ?? null, requestId);
    return { received: true, duplicate: false, handled };
  } catch (error) {
    await admin.from("webhook_events").update({
      status: "failed",
      attempts,
      last_error: error instanceof Error ? error.message.slice(0, 500) : "Webhook processing failed",
    }).eq("event_key", eventKey);
    throw new ApiError(503, "WEBHOOK_PROCESSING_FAILED", "The Razorpay webhook could not be processed.");
  }
}

export async function cleanupExpiredCheckouts() {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.from("checkout_sessions")
    .select("id")
    .in("status", ["creating_payment", "payment_pending"])
    .lt("reservation_expires_at", new Date().toISOString())
    .limit(100);
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Expired checkouts could not be loaded.");
  let released = 0;
  for (const session of data ?? []) {
    const result = await admin.rpc("release_checkout_inventory", { p_checkout_session_id: session.id, p_target_status: "expired" });
    if (!result.error) released += 1;
  }
  return { examined: data?.length ?? 0, released };
}

// Read-only lookup for the post-payment confirmation page (app/checkout/success).
// Reuses the same opaque capability-token pattern already used by /verify (stored
// guest_token_hash + constant-time compare) so a guest or a logged-in customer can
// view their own just-completed order without any new trust model, and without a
// syntactically-guessed checkoutId ever revealing another customer's order — the
// request must present the token minted for that specific session. Never modifies
// checkout/payment state; this only reads it.
export type CheckoutConfirmation =
  | { status: "completed"; order: MyOrderDetailDTO }
  | { status: "requires_review" | "payment_pending" | "creating_payment" | "failed" | "expired"; order: null };

export async function getCheckoutConfirmation(input: CheckoutConfirmationInput): Promise<CheckoutConfirmation> {
  const admin = createAdminSupabaseClient();
  const { data: session, error } = await admin
    .from("checkout_sessions")
    .select("id,status,order_id,guest_token_hash")
    .eq("id", input.checkoutId)
    .maybeSingle();
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "The order confirmation could not be loaded.");
  if (!session || !tokenMatches(input.checkoutToken, session.guest_token_hash)) {
    throw new ApiError(404, "CHECKOUT_NOT_FOUND", "Checkout session not found.");
  }

  if (session.status === "completed" && session.order_id) {
    const { data: order, error: orderError } = await admin
      .from("orders")
      .select(ORDER_DETAIL_SELECT)
      .eq("id", session.order_id)
      .maybeSingle();
    if (orderError || !order) throw new ApiError(503, "SERVICE_UNAVAILABLE", "The order confirmation could not be loaded.");
    return { status: "completed" as const, order: mapOrderDetailRow(order) };
  }

  const pendingStatuses = ["requires_review", "payment_pending", "creating_payment", "failed", "expired"] as const;
  const status = pendingStatuses.find((candidate) => candidate === session.status) ?? "failed";
  return { status, order: null };
}
