import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { requireUser } from "@/lib/auth/authorization";
import { requireHmacSecret } from "@/lib/env.server";
import { ApiError } from "@/lib/http/problem";
import { logger } from "@/lib/observability/logger";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { CheckoutConfirmationInput, CheckoutStartInput, CheckoutVerifyInput } from "@/features/checkout/schemas";
import { razorpayWebhookSchema } from "@/features/checkout/schemas";
import { mapOrderDetailRow, ORDER_DETAIL_SELECT, type MyOrderDetailDTO } from "@/features/customer-orders/dto";
import { processRefundWebhookEvent } from "@/features/refunds/service";
import {
  createRazorpayOrder,
  fetchRazorpayPayment,
  getRazorpayPublicConfig,
  getRazorpaySecret,
  verifyRazorpayPaymentSignature,
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
};

function one<T>(value: T | T[]) {
  return Array.isArray(value) ? value[0] : value;
}

function envMinor(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw new ApiError(503, "SERVICE_UNAVAILABLE", `${name} must be a non-negative integer.`);
  return value;
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
  const { data: variantRows, error: variantsError } = await admin
    .from("product_variants")
    .select("id,product_id,sku,stock_quantity,is_active,deleted_at,sort_order,colors(name,slug)")
    .in("product_id", productIds)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true });
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
    const unitPrice = product.sale_price_cents ?? product.base_price_cents;
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
  const freeShippingThreshold = envMinor("CHECKOUT_FREE_SHIPPING_THRESHOLD_MINOR", 3500);
  const flatShipping = envMinor("CHECKOUT_FLAT_SHIPPING_MINOR", 500);
  const shippingMinor = merchandiseMinor >= freeShippingThreshold ? 0 : flatShipping;
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
export async function startRazorpayCheckout(input: CheckoutStartInput) {
  const auth = await requireUser();
  const resolved = await resolveCheckoutLines(input);
  if (resolved.totalMinor < 100) throw new ApiError(422, "ORDER_TOTAL_TOO_LOW", "The order total is below the payment provider minimum.");

  const admin = createAdminSupabaseClient();
  const checkoutToken = randomBytes(32).toString("base64url");
  const reservationExpiresAt = new Date(Date.now() + 20 * 60_000).toISOString();
  const { data: session, error: sessionError } = await admin.from("checkout_sessions").insert({
    user_id: auth.userId,
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
}

// Exported (unchanged) so the RZ-050 admin retry action and the reconciliation
// sync job can reuse this exact, already-audited capture-to-order logic instead
// of duplicating it — both simply call it again with a freshly re-fetched payment.
export async function finalizeCapturedPayment(session: CheckoutRecord, payment: RazorpayPayment) {
  if (session.status === "completed" && session.order_id) return completedOrder(session.order_id);
  if (!session.razorpay_order_id || payment.order_id !== session.razorpay_order_id) throw new ApiError(409, "PAYMENT_ORDER_MISMATCH", "The payment does not belong to this checkout.");
  if (payment.amount !== session.total_minor || payment.currency.toUpperCase() !== session.currency) throw new ApiError(409, "PAYMENT_AMOUNT_MISMATCH", "The captured payment amount does not match the checkout total.");
  if (payment.status !== "captured" || payment.captured !== true) throw new ApiError(409, "PAYMENT_NOT_CAPTURED", "Payment is not captured yet.");

  const admin = createAdminSupabaseClient();
  const capturedAt = new Date(payment.created_at * 1000).toISOString();
  const { data: orderId, error } = await admin.rpc("complete_razorpay_checkout", {
    p_checkout_session_id: session.id,
    p_provider_payment_id: payment.id,
    p_payment_method: payment.method || "unknown",
    p_captured_at: capturedAt,
  });
  if (error || !orderId) {
    await markCapturedPaymentForReview(session, payment, error?.message || "Order conversion failed");
    throw new ApiError(409, "PAYMENT_REQUIRES_REVIEW", "Payment was captured, but the order needs manual review. Please contact support.");
  }
  return completedOrder(String(orderId));
}

export async function verifyAndCompleteRazorpayCheckout(input: CheckoutVerifyInput) {
  const session = await loadCheckout(input.checkoutId);
  if (!tokenMatches(input.checkoutToken, session.guest_token_hash)) throw new ApiError(404, "CHECKOUT_NOT_FOUND", "Checkout session not found.");
  if (session.status === "completed" && session.order_id) return completedOrder(session.order_id);
  if (session.status === "failed" || session.status === "expired") throw new ApiError(409, "CHECKOUT_EXPIRED", "This checkout is no longer active.");
  if (!session.razorpay_order_id || input.razorpayOrderId !== session.razorpay_order_id) throw new ApiError(409, "PAYMENT_ORDER_MISMATCH", "The payment does not belong to this checkout.");
  if (!verifyRazorpayPaymentSignature(session.razorpay_order_id, input.razorpayPaymentId, input.razorpaySignature, getRazorpaySecret())) {
    throw new ApiError(400, "PAYMENT_SIGNATURE_INVALID", "Payment verification failed.");
  }
  const payment = await fetchRazorpayPayment(input.razorpayPaymentId);
  return finalizeCapturedPayment(session, payment);
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

  // Free the reservation so the stock is available again (H7). Idempotent: a
  // no-op if the session is already completed/failed/expired.
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

export async function processRazorpayWebhook(rawBody: string, eventId: string, requestId: string) {
  const payloadHash = createHash("sha256").update(rawBody).digest("hex");
  const event = razorpayWebhookSchema.parse(JSON.parse(rawBody));
  const admin = createAdminSupabaseClient();
  const eventKey = `razorpay:${eventId}`;

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
    if (existing.status === "processed") return { received: true, duplicate: true };
    attempts = existing.attempts + 1;
  } else if (claim.error) {
    throw new ApiError(503, "SERVICE_UNAVAILABLE", "Webhook deduplication is unavailable.");
  }

  try {
    const entity = event.payload.payment?.entity;
    const refundEntity = event.payload.refund?.entity;
    if ((event.event === "payment.captured" || event.event === "order.paid") && entity) {
      const payment = await fetchRazorpayPayment(entity.id);
      if (payment.order_id) {
        const { data: session } = await admin.from("checkout_sessions").select("*").eq("razorpay_order_id", payment.order_id).maybeSingle();
        if (session) await finalizeCapturedPayment(session as CheckoutRecord, payment);
      }
    } else if (event.event === "payment.failed" && entity?.order_id) {
      const { data: session } = await admin.from("checkout_sessions").select("*").eq("razorpay_order_id", entity.order_id).maybeSingle();
      if (session) await recordFailedPayment(session as CheckoutRecord, entity as unknown as RazorpayPayment);
    } else if (event.event.startsWith("refund.") && refundEntity) {
      await processRefundWebhookEvent(refundEntity);
    }
    await admin.from("webhook_events").update({ status: "processed", processed_at: new Date().toISOString(), attempts, last_error: null }).eq("event_key", eventKey);
    await auditWebhookEvent(event.event, entity?.id ?? refundEntity?.id ?? null, requestId);
    return { received: true, duplicate: false };
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
