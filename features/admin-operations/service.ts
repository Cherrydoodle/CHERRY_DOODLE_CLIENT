import "server-only";

import type { z } from "zod";

import type { AuthContext } from "@/lib/auth/authorization";
import { ApiError } from "@/lib/http/problem";
import { logger } from "@/lib/observability/logger";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { mediaImageDto, privateMediaUrl, resolveReadyMediaImage } from "@/features/media/delivery";
import type { adminProfileUpdateSchema, colorCreateSchema, colorUpdateSchema, orderUpdateSchema, storeSettingsUpdateSchema } from "@/features/admin-operations/schemas";

type OrderUpdate = z.infer<typeof orderUpdateSchema>;
type SettingsUpdate = z.infer<typeof storeSettingsUpdateSchema>;
type ProfileUpdate = z.infer<typeof adminProfileUpdateSchema>;
type ColorCreate = z.infer<typeof colorCreateSchema>;
type ColorUpdate = z.infer<typeof colorUpdateSchema>;

// S10: an admin mutation that cannot be audited must not silently report success.
async function writeAudit(actor: AuthContext, action: string, resourceType: string, resourceId: string | null, before: unknown, after: unknown, requestId: string) {
  const { error } = await createAdminSupabaseClient().from("audit_logs").insert({
    actor_user_id: actor.userId, actor_role: actor.role, action, resource_type: resourceType,
    resource_id: resourceId, before_data: before ?? null, after_data: after ?? null, request_id: requestId,
  });
  if (error) {
    logger.error("audit_log_write_failed", { action, resourceType, resourceId, requestId, errorCode: error.code });
    throw new ApiError(503, "AUDIT_LOG_FAILED", "The action succeeded but could not be recorded in the audit trail. Please verify and retry if needed.");
  }
}

function orderSummary(row: Record<string, unknown>) {
  return {
    id: String(row.id), orderNumber: String(row.order_number), status: String(row.status),
    paymentStatus: String(row.payment_status ?? "pending"), paidAt: row.paid_at ? String(row.paid_at) : null,
    customer: { id: row.customer_user_id ? String(row.customer_user_id) : null, name: String(row.customer_name), email: String(row.customer_email), phone: String(row.customer_phone) },
    total: { amountMinor: Number(row.total_minor), currency: String(row.currency) },
    placedAt: String(row.placed_at), version: Number(row.version),
  };
}

export async function getDashboard() {
  const admin = createAdminSupabaseClient();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const [orders, todayOrders, products, customers, recent, pending, lowStockRows] = await Promise.all([
    admin.from("orders").select("*", { count: "exact", head: true }).is("deleted_at", null),
    admin.from("orders").select("*", { count: "exact", head: true }).gte("placed_at", today.toISOString()).is("deleted_at", null),
    admin.from("products").select("*", { count: "exact", head: true }).eq("status", "published").is("deleted_at", null),
    admin.from("user_roles").select("*", { count: "exact", head: true }).eq("role", "customer"),
    admin.from("orders").select("id,order_number,status,payment_status,paid_at,customer_user_id,customer_name,customer_email,customer_phone,total_minor,currency,placed_at,version").is("deleted_at", null).order("placed_at", { ascending: false }).limit(5),
    admin.from("orders").select("*", { count: "exact", head: true }).in("status", ["pending", "processing"]).is("deleted_at", null),
    admin.from("product_variants").select("stock_quantity,low_stock_threshold").eq("is_active", true).is("deleted_at", null).limit(1000),
  ]);
  if ([orders, todayOrders, products, customers, recent, pending, lowStockRows].some((result) => result.error)) {
    throw new ApiError(503, "SERVICE_UNAVAILABLE", "Dashboard metrics could not be loaded.");
  }
  return {
    stats: {
      totalOrders: orders.count ?? 0, todayOrders: todayOrders.count ?? 0,
      activeProducts: products.count ?? 0, customers: customers.count ?? 0,
      pendingOrders: pending.count ?? 0,
      lowStockVariants: (lowStockRows.data ?? []).filter((row) => row.stock_quantity <= row.low_stock_threshold).length,
    },
    recentOrders: (recent.data ?? []).map((row) => orderSummary(row)),
    generatedAt: new Date().toISOString(),
  };
}

export async function listColors() {
  const { data, error } = await createAdminSupabaseClient().from("colors").select("id,name,slug,hex_code,sort_order").is("deleted_at", null).order("sort_order").order("name");
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Colors could not be loaded.");
  return (data ?? []).map((row) => ({ id: row.id, name: String(row.name), slug: row.slug, hex: row.hex_code, sortOrder: row.sort_order }));
}

function colorSlug(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function colorDto(row: Record<string, unknown>) {
  return { id: String(row.id), name: String(row.name), slug: String(row.slug), hex: String(row.hex_code), sortOrder: Number(row.sort_order) };
}

export async function createColor(input: ColorCreate, actor: AuthContext, requestId: string) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.from("colors").insert({
    name: input.name, slug: colorSlug(input.name), hex_code: input.hex.toUpperCase(), sort_order: input.sortOrder ?? 0,
  }).select("id,name,slug,hex_code,sort_order").single();
  if (error) {
    if (error.code === "23505") throw new ApiError(409, "COLOR_EXISTS", "A color with that name already exists.");
    throw new ApiError(422, "VALIDATION_ERROR", "Color could not be created.");
  }
  await writeAudit(actor, "color.create", "color", data.id, null, data, requestId);
  return colorDto(data);
}

export async function updateColor(id: string, input: ColorUpdate, actor: AuthContext, requestId: string) {
  const admin = createAdminSupabaseClient();
  const { data: before } = await admin.from("colors").select("id,name,slug,hex_code,sort_order").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!before) throw new ApiError(404, "NOT_FOUND", "Color not found.");
  const patch = {
    ...(input.name !== undefined ? { name: input.name, slug: colorSlug(input.name) } : {}),
    ...(input.hex !== undefined ? { hex_code: input.hex.toUpperCase() } : {}),
    ...(input.sortOrder !== undefined ? { sort_order: input.sortOrder } : {}),
  };
  const { data, error } = await admin.from("colors").update(patch).eq("id", id).select("id,name,slug,hex_code,sort_order").maybeSingle();
  if (error) {
    if (error.code === "23505") throw new ApiError(409, "COLOR_EXISTS", "A color with that name already exists.");
    throw new ApiError(422, "VALIDATION_ERROR", "Color could not be updated.");
  }
  if (!data) throw new ApiError(404, "NOT_FOUND", "Color not found.");
  await writeAudit(actor, "color.update", "color", id, before, data, requestId);
  return colorDto(data);
}

export async function deleteColor(id: string, actor: AuthContext, requestId: string) {
  const admin = createAdminSupabaseClient();
  const { data: before } = await admin.from("colors").select("id,name,slug,hex_code,sort_order").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!before) throw new ApiError(404, "NOT_FOUND", "Color not found.");
  const { count } = await admin.from("product_variants").select("*", { count: "exact", head: true }).eq("color_id", id).is("deleted_at", null);
  if ((count ?? 0) > 0) throw new ApiError(409, "COLOR_IN_USE", "Remove this color from all product variants before deleting it.");
  const { data, error } = await admin.from("colors").update({ deleted_at: new Date().toISOString() }).eq("id", id).select("id").maybeSingle();
  if (error || !data) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Color could not be deleted.");
  await writeAudit(actor, "color.delete", "color", id, before, null, requestId);
}

// Resolves a Razorpay payment id to the order id(s) it is attached to. Two-step
// (payment_attempts -> checkout_sessions.order_id) rather than a nested PostgREST
// embed: payment_attempts has no direct FK to orders (it hangs off
// checkout_sessions), and a chained embed's cardinality isn't worth the risk on a
// path with no existing precedent in this codebase to verify against.
async function findOrderIdsByPaymentId(paymentId: string): Promise<string[]> {
  const admin = createAdminSupabaseClient();
  const { data: attempts } = await admin.from("payment_attempts").select("checkout_session_id").eq("provider", "razorpay").eq("provider_payment_id", paymentId);
  const sessionIds = [...new Set((attempts ?? []).map((row) => row.checkout_session_id as string))];
  if (sessionIds.length === 0) return [];
  const { data: sessions } = await admin.from("checkout_sessions").select("order_id").in("id", sessionIds).not("order_id", "is", null);
  return [...new Set((sessions ?? []).map((row) => row.order_id as string).filter(Boolean))];
}

export async function listOrders(options: { query?: string; status?: string; date?: string; paymentId?: string; page: number; limit: number }) {
  const admin = createAdminSupabaseClient();
  const start = (options.page - 1) * options.limit;
  let query = admin.from("orders").select("id,order_number,status,payment_status,paid_at,customer_user_id,customer_name,customer_email,customer_phone,total_minor,currency,placed_at,version", { count: "exact" }).is("deleted_at", null);
  if (options.status) query = query.eq("status", options.status);
  if (options.query) {
    const safe = options.query.replace(/[,%()]/g, " ").trim();
    query = query.or(`order_number.ilike.%${safe}%,customer_name.ilike.%${safe}%,customer_email.ilike.%${safe}%`);
  }
  if (options.date) {
    const from = new Date(`${options.date}T00:00:00.000Z`);
    const to = new Date(from.getTime() + 86_400_000);
    query = query.gte("placed_at", from.toISOString()).lt("placed_at", to.toISOString());
  }
  if (options.paymentId) {
    const orderIds = await findOrderIdsByPaymentId(options.paymentId);
    if (orderIds.length === 0) return { items: [], total: 0, page: options.page, limit: options.limit };
    query = query.in("id", orderIds);
  }
  const { data, error, count } = await query.order("placed_at", { ascending: false }).range(start, start + options.limit - 1);
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Orders could not be loaded.");
  return { items: (data ?? []).map((row) => orderSummary(row)), total: count ?? 0, page: options.page, limit: options.limit };
}

export async function getOrder(orderId: string) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.from("orders").select(`
    *,order_items(*,order_item_customizations(*,media_assets(id,status,storage_key,storage_provider,mime_type,alt_text,width,height,require_signed_urls))),
    order_status_history(id,from_status,to_status,reason,changed_by,created_at),
    order_internal_notes(id,body,author_user_id,created_at,updated_at,deleted_at),
    refunds(id,payment_attempt_id,razorpay_refund_id,amount_minor,currency,status,reason,initiated_by,error_description,created_at)
  `).eq("id", orderId).is("deleted_at", null).maybeSingle();
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Order details could not be loaded.");
  if (!data) throw new ApiError(404, "NOT_FOUND", "Order not found.");

  // payment_attempts has no direct FK to orders (it hangs off checkout_sessions),
  // so its full timeline -- provider ids, method, status, errors -- is fetched
  // with the same two-step lookup used by listOrders' payment-id search.
  const { data: checkoutSession } = await admin.from("checkout_sessions").select("id,razorpay_order_id").eq("order_id", orderId).maybeSingle();
  const { data: paymentAttemptRows } = checkoutSession
    ? await admin.from("payment_attempts")
        .select("id,provider_order_id,provider_payment_id,status,amount_minor,currency,method,error_code,error_description,created_at,updated_at")
        .eq("checkout_session_id", checkoutSession.id)
        .order("created_at", { ascending: true })
    : { data: [] as Record<string, unknown>[] | null };

  const items = await Promise.all((data.order_items ?? []).map(async (item: Record<string, unknown>) => ({
    id: String(item.id), productId: item.product_id ? String(item.product_id) : null,
    variantId: item.product_variant_id ? String(item.product_variant_id) : null,
    name: String(item.product_name), sku: item.sku ? String(item.sku) : null,
    quantity: Number(item.quantity), unitPriceMinor: Number(item.unit_price_minor), lineTotalMinor: Number(item.line_total_minor),
    customizations: await Promise.all(((item.order_item_customizations as Array<Record<string, unknown>> | null) ?? []).map(async (customization) => {
      const mediaValue = customization.media_assets;
      const media = Array.isArray(mediaValue) ? mediaValue[0] : mediaValue as Record<string, unknown> | null;
      return {
        id: String(customization.id), instructions: customization.instructions ? String(customization.instructions) : null,
        metadata: customization.metadata ?? {},
        imageUrl: media?.status === "ready" && media.storage_provider === "cloudinary" && media.storage_key ? await privateMediaUrl(String(media.storage_key), String(media.mime_type)) : null,
      };
    })),
  })));

  return {
    ...orderSummary(data), shippingAddress: data.shipping_address, customerNote: data.customer_note,
    subtotalMinor: data.subtotal_minor, discountMinor: data.discount_minor, shippingMinor: data.shipping_minor, taxMinor: data.tax_minor,
    carrier: data.carrier ?? null, trackingNumber: data.tracking_number ?? null, trackingUrl: data.tracking_url ?? null,
    items,
    statusHistory: (data.order_status_history ?? []).filter((row: Record<string, unknown>) => !row.deleted_at).map((row: Record<string, unknown>) => ({ id: String(row.id), from: row.from_status, to: row.to_status, reason: row.reason, changedBy: row.changed_by, createdAt: row.created_at })),
    internalNotes: (data.order_internal_notes ?? []).filter((row: Record<string, unknown>) => !row.deleted_at).map((row: Record<string, unknown>) => ({ id: String(row.id), body: row.body, authorUserId: row.author_user_id, createdAt: row.created_at, updatedAt: row.updated_at })),
    returnStatus: String(data.return_status ?? "none"),
    returnReason: data.return_reason ?? null,
    returnResolutionNote: data.return_resolution_note ?? null,
    paymentAttempts: (paymentAttemptRows ?? []).map((row) => ({
      id: String(row.id), razorpayOrderId: row.provider_order_id ? String(row.provider_order_id) : null,
      razorpayPaymentId: row.provider_payment_id ? String(row.provider_payment_id) : null,
      status: String(row.status), amountMinor: Number(row.amount_minor), currency: String(row.currency),
      method: row.method ? String(row.method) : null, errorCode: row.error_code ? String(row.error_code) : null,
      errorDescription: row.error_description ? String(row.error_description) : null,
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    })),
    refunds: ((data.refunds ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id), paymentAttemptId: String(row.payment_attempt_id), razorpayRefundId: row.razorpay_refund_id ? String(row.razorpay_refund_id) : null,
      amountMinor: Number(row.amount_minor), currency: String(row.currency), status: String(row.status), reason: String(row.reason),
      initiatedBy: row.initiated_by ? String(row.initiated_by) : null, errorDescription: row.error_description ? String(row.error_description) : null,
      createdAt: String(row.created_at),
    })),
  };
}

export async function updateOrder(orderId: string, input: OrderUpdate, actor: AuthContext, requestId: string) {
  const before = await getOrder(orderId);
  if (before.version !== input.expectedVersion) throw new ApiError(409, "VERSION_CONFLICT", "Order was changed by another user.");
  const admin = createAdminSupabaseClient();
  if (input.status && input.status !== before.status) {
    const { error } = await admin.rpc("transition_order_status", {
      p_order_id: orderId, p_expected_version: input.expectedVersion, p_new_status: input.status,
      p_actor_id: actor.userId, p_reason: input.statusReason ?? null,
    });
    if (error) {
      if (error.message.includes("VERSION_CONFLICT")) throw new ApiError(409, "VERSION_CONFLICT", "Order was changed by another user.");
      if (error.message.includes("INVALID_ORDER_TRANSITION")) throw new ApiError(409, "INVALID_ORDER_TRANSITION", "The requested order status transition is not allowed.");
      throw new ApiError(503, "SERVICE_UNAVAILABLE", "Order status could not be updated.");
    }
  }
  if (input.internalNote) {
    const { error } = await admin.from("order_internal_notes").insert({ order_id: orderId, body: input.internalNote, author_user_id: actor.userId });
    if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "The internal order note could not be saved.");
  }
  // Tracking fields are independent of the status-transition version bump above
  // (transition_order_status increments version itself when status also changes
  // in this same call), so this reads the current version immediately before
  // writing rather than reusing the caller's expectedVersion, which may already
  // be stale by the time this branch runs.
  if (input.carrier !== undefined || input.trackingNumber !== undefined || input.trackingUrl !== undefined) {
    const { data: current } = await admin.from("orders").select("version").eq("id", orderId).maybeSingle();
    if (!current) throw new ApiError(404, "NOT_FOUND", "Order not found.");
    const { data: updated, error } = await admin.from("orders").update({
      ...(input.carrier !== undefined ? { carrier: input.carrier } : {}),
      ...(input.trackingNumber !== undefined ? { tracking_number: input.trackingNumber } : {}),
      ...(input.trackingUrl !== undefined ? { tracking_url: input.trackingUrl } : {}),
      updated_by: actor.userId,
    }).eq("id", orderId).eq("version", current.version).select("id").maybeSingle();
    if (error || !updated) throw new ApiError(409, "VERSION_CONFLICT", "Order was changed by another user.");
  }
  const after = await getOrder(orderId);
  await writeAudit(actor, "order.update", "order", orderId, before, after, requestId);
  return after;
}

export async function listCustomers(options: { query?: string; page: number; limit: number }) {
  const { data, error } = await createAdminSupabaseClient().rpc("list_admin_customers", {
    p_query: options.query ?? null, p_limit: options.limit, p_offset: (options.page - 1) * options.limit,
  });
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Customers could not be loaded.");
  const rows = data ?? [];
  return {
    items: rows.map((row: Record<string, unknown>) => ({
      id: row.user_id, displayName: row.display_name, email: row.email, phoneNumber: row.phone_number,
      status: row.account_status, joinedAt: row.joined_at, address: row.default_address,
      orderCount: Number(row.order_count), lastOrderAt: row.last_order_at,
      avatar: row.avatar_storage_key ? mediaImageDto({ id: String(row.avatar_media_id), storageKey: String(row.avatar_storage_key), alt: String(row.avatar_alt_text ?? row.display_name), width: Number(row.avatar_width ?? 1), height: Number(row.avatar_height ?? 1) }) : null,
    })),
    total: rows.length ? Number(rows[0].total_count) : 0, page: options.page, limit: options.limit,
  };
}

export async function getCustomer(userId: string) {
  const admin = createAdminSupabaseClient();
  const [userResult, profileResult, addressesResult, ordersResult] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin.from("profiles").select("user_id,display_name,phone_number,account_status,avatar_media_id,created_at,media_assets(id,status,storage_key,storage_provider,alt_text,width,height)").eq("user_id", userId).is("deleted_at", null).maybeSingle(),
    admin.from("customer_addresses").select("*").eq("user_id", userId).is("deleted_at", null).order("is_default", { ascending: false }).order("updated_at", { ascending: false }),
    admin.from("orders").select("id,order_number,status,customer_user_id,customer_name,customer_email,customer_phone,total_minor,currency,placed_at,version").eq("customer_user_id", userId).is("deleted_at", null).order("placed_at", { ascending: false }).limit(20),
  ]);
  if (userResult.error || profileResult.error || !profileResult.data) throw new ApiError(404, "NOT_FOUND", "Customer not found.");
  const profile = profileResult.data;
  const mediaValue = profile.media_assets;
  const media = Array.isArray(mediaValue) ? mediaValue[0] : mediaValue;
  return {
    id: profile.user_id, displayName: profile.display_name, email: userResult.data.user.email ?? "",
    phoneNumber: profile.phone_number, status: profile.account_status, joinedAt: profile.created_at,
    avatar: media?.status === "ready" && media.storage_provider === "cloudinary" ? mediaImageDto({ id: media.id, storageKey: media.storage_key, alt: media.alt_text || profile.display_name, width: media.width ?? 1, height: media.height ?? 1 }) : null,
    addresses: addressesResult.data ?? [], recentOrders: (ordersResult.data ?? []).map((row) => orderSummary(row)),
  };
}

function settingsDto(row: Record<string, unknown>, logo: unknown, favicon: unknown) {
  return {
    storeName: row.store_name, phoneNumber: row.phone_number, email: row.email, website: row.website, address: row.address,
    instagramUrl: row.instagram_url ?? null,
    defaultCurrency: row.default_currency, locale: row.locale, timezone: row.timezone,
    logoMediaId: row.logo_media_id, faviconMediaId: row.favicon_media_id, logo, favicon,
    version: row.version, updatedAt: row.updated_at,
  };
}

export async function getStoreSettings() {
  const { data, error } = await createAdminSupabaseClient().from("store_settings").select("*").eq("singleton", true).single();
  if (error || !data) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Store settings could not be loaded.");
  const [logo, favicon] = await Promise.all([resolveReadyMediaImage(data.logo_media_id), resolveReadyMediaImage(data.favicon_media_id)]);
  return settingsDto(data, logo, favicon);
}

async function requireBrandMedia(mediaId: string) {
  const { data } = await createAdminSupabaseClient().from("media_assets").select("id").eq("id", mediaId).eq("purpose", "brand").eq("status", "ready").is("deleted_at", null).maybeSingle();
  if (!data) throw new ApiError(422, "MEDIA_NOT_READY", "Brand media must be a ready Cloudinary image.");
}

export async function updateStoreSettings(input: SettingsUpdate, actor: AuthContext, requestId: string) {
  if (input.logoMediaId) await requireBrandMedia(input.logoMediaId);
  if (input.faviconMediaId) await requireBrandMedia(input.faviconMediaId);
  const admin = createAdminSupabaseClient();
  const { expectedVersion, ...fields } = input;
  const before = await getStoreSettings();
  const patch = {
    ...(fields.storeName !== undefined ? { store_name: fields.storeName } : {}),
    ...(fields.phoneNumber !== undefined ? { phone_number: fields.phoneNumber } : {}),
    ...(fields.email !== undefined ? { email: fields.email } : {}), ...(fields.website !== undefined ? { website: fields.website } : {}),
    ...(fields.address !== undefined ? { address: fields.address } : {}), ...(fields.instagramUrl !== undefined ? { instagram_url: fields.instagramUrl } : {}),
    ...(fields.defaultCurrency !== undefined ? { default_currency: fields.defaultCurrency } : {}),
    ...(fields.locale !== undefined ? { locale: fields.locale } : {}), ...(fields.timezone !== undefined ? { timezone: fields.timezone } : {}),
    ...(fields.logoMediaId !== undefined ? { logo_media_id: fields.logoMediaId } : {}), ...(fields.faviconMediaId !== undefined ? { favicon_media_id: fields.faviconMediaId } : {}),
    updated_by: actor.userId,
  };
  const { data } = await admin.from("store_settings").update(patch).eq("singleton", true).eq("version", expectedVersion).select("*").maybeSingle();
  if (!data) throw new ApiError(409, "VERSION_CONFLICT", "Store settings were changed by another user.");
  const after = await getStoreSettings();
  await writeAudit(actor, "settings.update", "store_settings", null, before, after, requestId);
  return after;
}

export async function getAdminProfile(actor: AuthContext) {
  const admin = createAdminSupabaseClient();
  const [userResult, profileResult] = await Promise.all([
    admin.auth.admin.getUserById(actor.userId),
    admin.from("profiles").select("user_id,display_name,phone_number,account_status,avatar_media_id,created_at,updated_at,media_assets(id,status,storage_key,storage_provider,alt_text,width,height)").eq("user_id", actor.userId).maybeSingle(),
  ]);
  if (userResult.error || !profileResult.data) throw new ApiError(404, "NOT_FOUND", "Administrator profile not found.");
  const profile = profileResult.data;
  const mediaValue = profile.media_assets;
  const media = Array.isArray(mediaValue) ? mediaValue[0] : mediaValue;
  return {
    id: actor.userId, displayName: profile.display_name, email: userResult.data.user.email ?? "", phoneNumber: profile.phone_number,
    role: actor.role, status: profile.account_status, joinedAt: profile.created_at, lastSignInAt: userResult.data.user.last_sign_in_at ?? null,
    avatarMediaId: profile.avatar_media_id,
    avatar: media?.status === "ready" && media.storage_provider === "cloudinary" ? mediaImageDto({ id: media.id, storageKey: media.storage_key, alt: media.alt_text || profile.display_name, width: media.width ?? 1, height: media.height ?? 1 }) : null,
  };
}

export async function updateAdminProfile(input: ProfileUpdate, actor: AuthContext, requestId: string) {
  if (input.avatarMediaId) {
    const { data } = await createAdminSupabaseClient().from("media_assets").select("id").eq("id", input.avatarMediaId).eq("purpose", "avatar").eq("status", "ready").is("deleted_at", null).maybeSingle();
    if (!data) throw new ApiError(422, "MEDIA_NOT_READY", "Avatar media must be ready.");
  }
  const before = await getAdminProfile(actor);
  const patch = {
    ...(input.displayName !== undefined ? { display_name: input.displayName } : {}),
    ...(input.phoneNumber !== undefined ? { phone_number: input.phoneNumber } : {}),
    ...(input.avatarMediaId !== undefined ? { avatar_media_id: input.avatarMediaId } : {}),
  };
  const { error } = await createAdminSupabaseClient().from("profiles").update(patch).eq("user_id", actor.userId).is("deleted_at", null);
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Administrator profile could not be updated.");
  const after = await getAdminProfile(actor);
  await writeAudit(actor, "profile.update", "profile", actor.userId, before, after, requestId);
  return after;
}

export async function changeAdminPassword(currentPassword: string, newPassword: string, actor: AuthContext, requestId: string) {
  const supabase = await createServerSupabaseClient();
  if (!actor.email) throw new ApiError(401, "AUTH_REQUIRED", "Authentication is required.");
  const { error: reauthError } = await supabase.auth.signInWithPassword({ email: actor.email, password: currentPassword });
  if (reauthError) throw new ApiError(401, "INVALID_CREDENTIALS", "Current password is incorrect.");
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new ApiError(422, "WEAK_PASSWORD", "The new password does not meet the password policy.");
  await writeAudit(actor, "profile.password_change", "profile", actor.userId, null, { changed: true }, requestId);
  return { changed: true as const };
}
