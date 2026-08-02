import "server-only";

import { createHash } from "node:crypto";

import type { z } from "zod";

import type { AuthContext } from "@/lib/auth/authorization";
import { requireDelhiveryConfig } from "@/lib/env.server";
import { ApiError } from "@/lib/http/problem";
import { logger } from "@/lib/observability/logger";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { enqueueEmail } from "@/features/email/service";

import {
  checkPincode,
  createManifest,
  createPickupRequest,
  fetchPackingSlip,
  fetchWaybills,
  trackWaybills,
} from "@/features/delhivery/client";
import { normalizeIndianPhone, normalizeIndianPin } from "@/features/delhivery/normalize";
import { buildManifestShipment, buildPickupLocation } from "@/features/delhivery/payload";
import type { pickupRequestInputSchema, shipmentCreateInputSchema } from "@/features/delhivery/schemas";
import { trackingPushSchema } from "@/features/delhivery/schemas";
import { advanceOrderTo, targetOrderStatusForScan, type DelhiveryScanInfo, type OrderStatus } from "@/features/delhivery/status-map";

type ShipmentCreateInput = z.infer<typeof shipmentCreateInputSchema>;
type PickupRequestInput = z.infer<typeof pickupRequestInputSchema>;
type SupabaseAdmin = ReturnType<typeof createAdminSupabaseClient>;

const TRACKING_URL_PREFIX = "https://www.delhivery.com/track/package/";
const SERVICEABILITY_CACHE_TTL_MS = 7 * 24 * 60 * 60_000;

async function writeAudit(actor: AuthContext | null, action: string, resourceId: string | null, before: unknown, after: unknown, requestId: string) {
  const { error } = await createAdminSupabaseClient().from("audit_logs").insert({
    actor_user_id: actor?.userId ?? null, actor_role: actor?.role ?? null, action, resource_type: "shipment",
    resource_id: resourceId, before_data: before ?? null, after_data: after ?? null, request_id: requestId,
  });
  if (error) logger.error("delhivery_audit_write_failed", { action, resourceId, requestId, errorCode: error.code });
}

function toBool(value: string | boolean | undefined): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return /^(y|yes|true)$/i.test(value.trim());
  return false;
}

export type ServiceabilityResult = { serviceable: boolean; prepaid: boolean; cod: boolean; city: string | null; state: string | null };

/**
 * Read-through cache over Delhivery's pincode serviceability API
 * (public.pincode_serviceability, 7-day TTL). Returns `null` only when there is no
 * usable answer at all (no cache row, and Delhivery is unreachable) -- callers
 * decide whether that means "block" (manifest) or "allow" (checkout).
 */
export async function getServiceability(pin: string): Promise<ServiceabilityResult | null> {
  const admin = createAdminSupabaseClient();
  const { data: cached } = await admin.from("pincode_serviceability").select("*").eq("postal_code", pin).maybeSingle();
  const fresh = cached && Date.now() - new Date(cached.checked_at).getTime() < SERVICEABILITY_CACHE_TTL_MS;
  if (fresh) {
    return { serviceable: cached.is_serviceable, prepaid: cached.prepaid ?? false, cod: cached.cod ?? false, city: cached.city, state: cached.state_code };
  }

  let response;
  try {
    response = await checkPincode(pin);
  } catch (error) {
    if (cached) {
      logger.warn("delhivery_serviceability_refresh_failed_using_stale_cache", { pin, errorMessage: error instanceof Error ? error.message : "unknown" });
      return { serviceable: cached.is_serviceable, prepaid: cached.prepaid ?? false, cod: cached.cod ?? false, city: cached.city, state: cached.state_code };
    }
    logger.warn("delhivery_serviceability_check_failed", { pin, errorMessage: error instanceof Error ? error.message : "unknown" });
    return null;
  }

  const entry = response.delivery_codes[0]?.postal_code;
  const result: ServiceabilityResult = {
    serviceable: Boolean(entry),
    prepaid: entry ? toBool(entry.pre_paid) : false,
    cod: entry ? toBool(entry.cod) : false,
    city: entry?.city ?? null,
    state: entry?.state_code ?? null,
  };
  await admin.from("pincode_serviceability").upsert({
    postal_code: pin, is_serviceable: result.serviceable, prepaid: result.prepaid, cod: result.cod,
    city: result.city, state_code: result.state, district: entry?.district ?? null,
    max_amount: entry?.max_amount ? Number(entry.max_amount) : null, checked_at: new Date().toISOString(),
  });
  return result;
}

/**
 * Checkout-time gate. Fails OPEN: if Delhivery cannot be reached and there is no
 * cache to fall back on, checkout proceeds. Blocking every sale on a third-party
 * outage is worse than the rare unshippable order, which createShipmentForOrder
 * below (fail-CLOSED, a real waybill is real money) catches at ship time.
 */
export async function assertPincodeServiceableForCheckout(address: { postalCode: string; country: string }) {
  if (address.country !== "IN") return;
  const pin = normalizeIndianPin(address.postalCode);
  if (!pin) throw new ApiError(422, "INVALID_PINCODE", "Enter a valid 6-digit Indian pincode.");
  const result = await getServiceability(pin);
  if (result === null) {
    logger.warn("delhivery_serviceability_unknown_allowing_checkout", { pin });
    return;
  }
  if (!result.serviceable) throw new ApiError(422, "PINCODE_NOT_SERVICEABLE", "We can't deliver to this pincode yet. Try a different address.");
}

export async function hasActiveShipment(orderId: string): Promise<boolean> {
  const { data } = await createAdminSupabaseClient().from("shipments").select("id").eq("order_id", orderId).is("deleted_at", null).is("cancelled_at", null).maybeSingle();
  return Boolean(data);
}

/** Records that an admin has cancelled the waybill in Delhivery's own panel (the
 * Cancel Order API itself is out of scope for this integration -- see the plan). */
export async function acknowledgeShipmentCancellation(orderId: string, actor: AuthContext) {
  const admin = createAdminSupabaseClient();
  const { data } = await admin.from("shipments").select("id,version").eq("order_id", orderId).is("deleted_at", null).is("cancelled_at", null).maybeSingle();
  if (!data) return;
  await admin.from("shipments").update({ cancelled_at: new Date().toISOString(), updated_by: actor.userId }).eq("id", data.id).eq("version", data.version);
}

export type ShipmentDTO = {
  id: string; waybill: string; status: string | null; statusType: string | null; nslCode: string | null;
  statusLocation: string | null; statusInstructions: string | null; statusAt: string | null;
  weightGrams: number; lengthCm: number; breadthCm: number; heightCm: number;
  pickupLocation: string; manifestedAt: string | null; pickedUpAt: string | null; deliveredAt: string | null;
  cancelledAt: string | null; lastSyncedAt: string | null; lastError: string | null; version: number;
  trackingUrl: string;
  scans: Array<{ id: string; status: string; location: string | null; instructions: string | null; scannedAt: string }>;
};

function shipmentDto(row: Record<string, unknown>, scans: Array<Record<string, unknown>>): ShipmentDTO {
  return {
    id: String(row.id), waybill: String(row.waybill), status: row.status ? String(row.status) : null,
    statusType: row.status_type ? String(row.status_type) : null, nslCode: row.nsl_code ? String(row.nsl_code) : null,
    statusLocation: row.status_location ? String(row.status_location) : null,
    statusInstructions: row.status_instructions ? String(row.status_instructions) : null,
    statusAt: row.status_at ? String(row.status_at) : null,
    weightGrams: Number(row.weight_grams), lengthCm: Number(row.length_cm), breadthCm: Number(row.breadth_cm), heightCm: Number(row.height_cm),
    pickupLocation: String(row.pickup_location), manifestedAt: row.manifested_at ? String(row.manifested_at) : null,
    pickedUpAt: row.picked_up_at ? String(row.picked_up_at) : null, deliveredAt: row.delivered_at ? String(row.delivered_at) : null,
    cancelledAt: row.cancelled_at ? String(row.cancelled_at) : null, lastSyncedAt: row.last_synced_at ? String(row.last_synced_at) : null,
    lastError: row.last_error ? String(row.last_error) : null, version: Number(row.version),
    trackingUrl: `${TRACKING_URL_PREFIX}${row.waybill}`,
    scans: scans
      .slice()
      .sort((a, b) => String(a.scanned_at).localeCompare(String(b.scanned_at)))
      .map((scan) => ({
        id: String(scan.id), status: String(scan.scan_status), location: scan.scan_location ? String(scan.scan_location) : null,
        instructions: scan.scan_instructions ? String(scan.scan_instructions) : null, scannedAt: String(scan.scanned_at),
      })),
  };
}

/** Fetches the active (or most recent) shipment for an order, with its scan
 * history, for the admin order detail view. Returns null when the order has never
 * been shipped through Delhivery. */
export async function getShipmentForOrder(orderId: string): Promise<ShipmentDTO | null> {
  const admin = createAdminSupabaseClient();
  const { data: shipment } = await admin.from("shipments").select("*").eq("order_id", orderId).is("deleted_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!shipment) return null;
  const { data: scans } = await admin.from("shipment_scans").select("*").eq("shipment_id", shipment.id);
  return shipmentDto(shipment, scans ?? []);
}

/**
 * Manifests an order with Delhivery: resolves parcel weight/dimensions, re-checks
 * serviceability (fail-CLOSED here, unlike the checkout gate -- a waybill is real
 * money), reserves an AWB, and submits the shipment. Advances the order
 * pending -> processing and writes carrier/tracking fields on success.
 */
export async function createShipmentForOrder(orderId: string, input: ShipmentCreateInput, actor: AuthContext, requestId: string) {
  const admin = createAdminSupabaseClient();
  const { data: order, error } = await admin.from("orders")
    .select("id,order_number,status,payment_status,customer_name,customer_phone,shipping_address,total_minor,version")
    .eq("id", orderId).is("deleted_at", null).maybeSingle();
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "The order could not be loaded.");
  if (!order) throw new ApiError(404, "NOT_FOUND", "Order not found.");
  if (order.version !== input.expectedVersion) throw new ApiError(409, "VERSION_CONFLICT", "Order was changed by another user.");
  if (order.payment_status !== "paid") throw new ApiError(422, "ORDER_NOT_PAID", "Only a paid order can be shipped.");
  if (order.status === "cancelled") throw new ApiError(422, "ORDER_CANCELLED", "A cancelled order cannot be shipped.");
  if (await hasActiveShipment(orderId)) throw new ApiError(409, "SHIPMENT_EXISTS", "This order already has an active shipment.");

  const { data: itemRows, error: itemsError } = await admin.from("order_items")
    .select("quantity,product_name,product_variants(weight_grams)").eq("order_id", orderId);
  if (itemsError) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Order items could not be loaded.");
  const items = itemRows ?? [];
  if (items.length === 0) throw new ApiError(422, "ORDER_EMPTY", "This order has no items to ship.");

  const config = requireDelhiveryConfig();
  const totalQuantity = items.reduce((sum, item) => sum + Number(item.quantity), 0);
  const computedWeight = items.reduce((sum, item) => {
    const variant = item.product_variants as { weight_grams: number | null } | { weight_grams: number | null }[] | null;
    const resolved = Array.isArray(variant) ? variant[0] : variant;
    const unitWeight = resolved?.weight_grams ?? config.defaultWeightGrams;
    return sum + unitWeight * Number(item.quantity);
  }, 0);

  const parcel = {
    weightGrams: input.weightGrams ?? computedWeight,
    lengthCm: input.lengthCm ?? config.defaultLengthCm,
    breadthCm: input.breadthCm ?? config.defaultBreadthCm,
    heightCm: input.heightCm ?? config.defaultHeightCm,
  };

  const shippingAddress = order.shipping_address as { line1: string; line2?: string | null; city: string; state: string; postalCode: string };
  const normalizedPin = normalizeIndianPin(shippingAddress.postalCode);
  if (!normalizedPin) throw new ApiError(422, "INVALID_PINCODE", "This order's shipping address does not have a valid Indian pincode.");
  const normalizedPhone = normalizeIndianPhone(order.customer_phone);
  if (!normalizedPhone) throw new ApiError(422, "INVALID_PHONE", "This order's phone number could not be normalized for Delhivery.");

  const serviceability = await getServiceability(normalizedPin);
  if (!serviceability) throw new ApiError(502, "SHIPPING_PROVIDER_UNAVAILABLE", "Delhivery could not be reached to verify serviceability. Please try again.");
  if (!serviceability.serviceable) throw new ApiError(422, "PINCODE_NOT_SERVICEABLE", "Delhivery does not currently service this pincode.");

  const [waybill] = await fetchWaybills(1);
  const productsDescription = items.map((item) => item.product_name).join(", ").slice(0, 500);

  // The shipment row is written before the manifest call so a reserved waybill is
  // never silently lost if the process crashes between the two steps.
  const { data: shipmentRow, error: insertError } = await admin.from("shipments").insert({
    order_id: orderId, waybill, weight_grams: parcel.weightGrams, length_cm: parcel.lengthCm,
    breadth_cm: parcel.breadthCm, height_cm: parcel.heightCm, declared_value_minor: order.total_minor,
    pickup_location: config.pickupLocationName, created_by: actor.userId, updated_by: actor.userId,
  }).select("id").single();
  if (insertError || !shipmentRow) {
    if (insertError?.code === "23505") throw new ApiError(409, "SHIPMENT_EXISTS", "This order already has an active shipment.");
    throw new ApiError(503, "SERVICE_UNAVAILABLE", "The shipment record could not be created.");
  }

  let manifestResult;
  try {
    manifestResult = await createManifest({
      shipments: [buildManifestShipment(
        {
          orderNumber: order.order_number, waybill, customerName: order.customer_name, customerPhone: normalizedPhone,
          shippingAddress: { ...shippingAddress, postalCode: normalizedPin }, totalMinor: order.total_minor,
          productsDescription, quantity: totalQuantity,
        },
        parcel,
        config,
      )],
      pickupLocation: buildPickupLocation(config),
    });
  } catch (submissionError) {
    await admin.from("shipments").update({ last_error: submissionError instanceof Error ? submissionError.message.slice(0, 500) : "Unknown error" }).eq("id", shipmentRow.id);
    throw submissionError;
  }

  const packageResult = manifestResult.packages[0];
  if (!packageResult || packageResult.status?.toLowerCase() !== "success") {
    const reason = (packageResult?.remarks?.join("; ") || manifestResult.rmk || "Delhivery rejected the shipment.").slice(0, 500);
    await admin.from("shipments").update({ last_error: reason, raw_manifest_response: manifestResult }).eq("id", shipmentRow.id);
    throw new ApiError(502, "SHIPPING_PROVIDER_ERROR", "Delhivery rejected this shipment. Check the order details and try again.");
  }

  await admin.from("shipments").update({
    manifested_at: new Date().toISOString(), status: "Manifested", raw_manifest_response: manifestResult, last_error: null,
  }).eq("id", shipmentRow.id);

  // Status transition first (consumes the caller's version), tracking-field write
  // second (reads the fresh post-transition version) -- same ordering rationale as
  // features/admin-operations/service.ts#updateOrder.
  let orderVersion = order.version;
  if (order.status === "pending") {
    const { data: transitioned, error: transitionError } = await admin.rpc("transition_order_status", {
      p_order_id: orderId, p_expected_version: orderVersion, p_new_status: "processing", p_actor_id: actor.userId, p_reason: "Shipped via Delhivery",
    });
    if (transitionError) logger.error("delhivery_order_transition_failed", { orderId, requestId, errorMessage: transitionError.message });
    else {
      const row = (Array.isArray(transitioned) ? transitioned[0] : transitioned) as { version?: number } | null;
      orderVersion = row?.version ?? orderVersion;
    }
  }
  const trackingUrl = `${TRACKING_URL_PREFIX}${waybill}`;
  await admin.from("orders").update({
    carrier: "Delhivery", tracking_number: waybill, tracking_url: trackingUrl, updated_by: actor.userId,
  }).eq("id", orderId).eq("version", orderVersion);

  await writeAudit(actor, "shipment.create", shipmentRow.id, null, { waybill, orderId }, requestId);
  const result = await getShipmentForOrder(orderId);
  if (!result) throw new ApiError(503, "SERVICE_UNAVAILABLE", "The shipment was created but could not be reloaded.");
  return result;
}

async function recordScanHistory(admin: SupabaseAdmin, shipmentId: string, entries: Array<{ status: string; statusType: string | null; location: string | null; instructions: string | null; nslCode: string | null; scannedAt: string }>) {
  for (const entry of entries) {
    await admin.from("shipment_scans").upsert({
      shipment_id: shipmentId, scan_status: entry.status, scan_type: entry.statusType,
      scan_location: entry.location, scan_instructions: entry.instructions, nsl_code: entry.nslCode, scanned_at: entry.scannedAt,
    }, { onConflict: "shipment_id,scanned_at,scan_status", ignoreDuplicates: true });
  }
}

/** Applies the shipment's CURRENT status (top-level `Shipment.Status`, the single
 * source of truth) to the shipment row and, if it implies forward progress, walks
 * the order through public.transition_order_status() one hop at a time. Shared by
 * both the pull job and the push webhook so there is exactly one code path that
 * mutates order state from tracking data. */
async function applyCurrentStatus(
  admin: SupabaseAdmin,
  shipmentId: string,
  orderId: string,
  scan: DelhiveryScanInfo & { statusLocation: string | null; instructions: string | null; scannedAt: string },
  requestId: string,
) {
  const target = targetOrderStatusForScan(scan);
  const patch: Record<string, unknown> = {
    status: scan.status, status_type: scan.statusType, nsl_code: scan.nslCode,
    status_location: scan.statusLocation, status_instructions: scan.instructions, status_at: scan.scannedAt,
    last_synced_at: new Date().toISOString(), last_error: null,
  };
  if (scan.pickUpDate) patch.picked_up_at = scan.pickUpDate;
  if (target === "delivered") patch.delivered_at = new Date().toISOString();
  await admin.from("shipments").update(patch).eq("id", shipmentId);

  if (!target) return;
  const { data: order } = await admin.from("orders").select("id,status,version,customer_email,customer_name,order_number").eq("id", orderId).is("deleted_at", null).maybeSingle();
  if (!order) return;
  const path = advanceOrderTo(order.status as OrderStatus, target);
  if (!path) return;

  let version = order.version as number;
  let crossedIntoShipped = false;
  for (const step of path) {
    const { data: transitioned, error } = await admin.rpc("transition_order_status", {
      p_order_id: orderId, p_expected_version: version, p_new_status: step, p_actor_id: null, p_reason: "Delhivery tracking update",
    });
    if (error) {
      logger.warn("delhivery_sync_transition_failed", { orderId, step, requestId, errorMessage: error.message });
      return;
    }
    const row = (Array.isArray(transitioned) ? transitioned[0] : transitioned) as { version?: number } | null;
    version = row?.version ?? version + 1;
    if (step === "shipped") crossedIntoShipped = true;
  }

  if (crossedIntoShipped) {
    const { data: shipment } = await admin.from("shipments").select("waybill").eq("id", shipmentId).maybeSingle();
    await enqueueEmail("order_shipped", String(order.customer_email), {
      orderNumber: order.order_number, customerName: order.customer_name,
      trackingUrl: shipment ? `${TRACKING_URL_PREFIX}${shipment.waybill}` : null,
    });
  }
}

/**
 * Cron-driven tracking pull, invoked from `POST /api/internal/jobs/delhivery-tracking`
 * every ~15 minutes. Chunks waybills 20-per-request (well under the 750-per-5-min
 * rate limit) and is the tracking backstop while the push webhook is still pending
 * Delhivery's 5-6 business day onboarding (and remains the backstop afterward, for
 * any push delivery that never arrives).
 */
export async function syncShipments(limit = 50, requestId = "cron") {
  const admin = createAdminSupabaseClient();
  const { data: rows, error } = await admin.from("shipments")
    .select("id,order_id,waybill,sync_attempts")
    .is("deleted_at", null).is("cancelled_at", null).is("delivered_at", null)
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Shipments could not be loaded for sync.");
  const shipments = rows ?? [];
  if (shipments.length === 0) return { checked: 0, updated: 0, failed: 0 };

  const CHUNK_SIZE = 20;
  let updated = 0;
  let failed = 0;
  for (let i = 0; i < shipments.length; i += CHUNK_SIZE) {
    const chunk = shipments.slice(i, i + CHUNK_SIZE);
    const byWaybill = new Map(chunk.map((row) => [row.waybill, row]));

    let tracking;
    try {
      tracking = await trackWaybills(chunk.map((row) => row.waybill));
    } catch (trackingError) {
      failed += chunk.length;
      logger.warn("delhivery_tracking_sync_chunk_failed", { requestId, errorMessage: trackingError instanceof Error ? trackingError.message : "unknown" });
      for (const row of chunk) {
        await admin.from("shipments").update({ sync_attempts: row.sync_attempts + 1, last_synced_at: new Date().toISOString() }).eq("id", row.id);
      }
      continue;
    }

    for (const entry of tracking.ShipmentData) {
      const awb = entry.Shipment.AWB;
      const row = awb ? byWaybill.get(awb) : undefined;
      if (!row) continue;

      await recordScanHistory(admin, row.id, entry.Shipment.Scans.filter((scan) => scan.ScanDetail.ScanDateTime).map((scan) => ({
        status: scan.ScanDetail.Scan ?? "Unknown", statusType: scan.ScanDetail.ScanType ?? null,
        location: scan.ScanDetail.ScannedLocation ?? null, instructions: scan.ScanDetail.Instructions ?? null,
        nslCode: scan.ScanDetail.StatusCode ?? null, scannedAt: scan.ScanDetail.ScanDateTime!,
      })));

      const status = entry.Shipment.Status;
      await applyCurrentStatus(admin, row.id, row.order_id, {
        statusType: status?.StatusType ?? null, status: status?.Status ?? null, nslCode: status?.NSLCode ?? null,
        pickUpDate: entry.Shipment.PickUpDate ?? null, statusLocation: status?.StatusLocation ?? null,
        instructions: status?.Instructions ?? null, scannedAt: status?.StatusDateTime ?? new Date().toISOString(),
      }, requestId);
      updated += 1;
    }
  }
  return { checked: shipments.length, updated, failed };
}

/** On-demand refresh for a single order's shipment (the admin "Sync now" button),
 * sharing the same recordScanHistory/applyCurrentStatus path as the cron job. */
export async function syncShipmentForOrder(orderId: string, requestId = "manual-sync") {
  const admin = createAdminSupabaseClient();
  const { data: shipment } = await admin.from("shipments").select("id,waybill").eq("order_id", orderId).is("deleted_at", null).is("cancelled_at", null).maybeSingle();
  if (!shipment) throw new ApiError(404, "NOT_FOUND", "This order has no active Delhivery shipment.");

  const tracking = await trackWaybills([shipment.waybill]);
  const entry = tracking.ShipmentData.find((item) => item.Shipment.AWB === shipment.waybill);
  if (!entry) throw new ApiError(502, "SHIPPING_PROVIDER_ERROR", "Delhivery returned no tracking data for this waybill.");

  await recordScanHistory(admin, shipment.id, entry.Shipment.Scans.filter((scan) => scan.ScanDetail.ScanDateTime).map((scan) => ({
    status: scan.ScanDetail.Scan ?? "Unknown", statusType: scan.ScanDetail.ScanType ?? null,
    location: scan.ScanDetail.ScannedLocation ?? null, instructions: scan.ScanDetail.Instructions ?? null,
    nslCode: scan.ScanDetail.StatusCode ?? null, scannedAt: scan.ScanDetail.ScanDateTime!,
  })));
  const status = entry.Shipment.Status;
  await applyCurrentStatus(admin, shipment.id, orderId, {
    statusType: status?.StatusType ?? null, status: status?.Status ?? null, nslCode: status?.NSLCode ?? null,
    pickUpDate: entry.Shipment.PickUpDate ?? null, statusLocation: status?.StatusLocation ?? null,
    instructions: status?.Instructions ?? null, scannedAt: status?.StatusDateTime ?? new Date().toISOString(),
  }, requestId);

  const result = await getShipmentForOrder(orderId);
  if (!result) throw new ApiError(503, "SERVICE_UNAVAILABLE", "The shipment could not be reloaded after sync.");
  return result;
}

/**
 * Handles Delhivery's tracking PUSH webhook. Unlike Razorpay's, this payload
 * carries no signature -- authentication happens entirely at the route layer via
 * a shared bearer secret (requireDelhiveryWebhookSecret). Deduplicates on the
 * SHA-256 of the raw body via the shared `webhook_events` table, exactly like
 * processRazorpayWebhook.
 */
export async function processDelhiveryPush(rawBody: string, requestId: string) {
  const payloadHash = createHash("sha256").update(rawBody).digest("hex");

  let parsed: z.infer<typeof trackingPushSchema>;
  try {
    const result = trackingPushSchema.safeParse(JSON.parse(rawBody));
    if (!result.success) {
      logger.warn("delhivery_push_unmodelled", { requestId, payloadHash });
      return { received: true, duplicate: false, handled: false };
    }
    parsed = result.data;
  } catch {
    logger.warn("delhivery_push_unparsable_json", { requestId, payloadHash });
    return { received: true, duplicate: false, handled: false };
  }

  const admin = createAdminSupabaseClient();
  const eventKey = `delhivery:${payloadHash}`;
  const claim = await admin.from("webhook_events").insert({ provider: "delhivery", event_key: eventKey, payload_hash: payloadHash, status: "received" });
  if (claim.error?.code === "23505") {
    const { data: existing, error: lookupError } = await admin.from("webhook_events").select("status").eq("event_key", eventKey).maybeSingle();
    if (lookupError || !existing) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Webhook deduplication is unavailable.");
    if (existing.status === "processed") return { received: true, duplicate: true, handled: true };
  } else if (claim.error) {
    throw new ApiError(503, "SERVICE_UNAVAILABLE", "Webhook deduplication is unavailable.");
  }

  try {
    const waybill = parsed.Shipment.AWB;
    const { data: shipment } = await admin.from("shipments").select("id,order_id").eq("waybill", waybill).is("deleted_at", null).maybeSingle();
    let handled = true;
    if (!shipment) {
      logger.warn("delhivery_push_unknown_waybill", { requestId, waybill });
      handled = false;
    } else {
      const status = parsed.Shipment.Status;
      const scannedAt = status.StatusDateTime ?? new Date().toISOString();
      await recordScanHistory(admin, shipment.id, [{
        status: status.Status ?? "Unknown", statusType: status.StatusType ?? null, location: status.StatusLocation ?? null,
        instructions: status.Instructions ?? null, nslCode: status.NSLCode ?? null, scannedAt,
      }]);
      await applyCurrentStatus(admin, shipment.id, shipment.order_id, {
        statusType: status.StatusType ?? null, status: status.Status ?? null, nslCode: status.NSLCode ?? null,
        pickUpDate: parsed.Shipment.PickUpDate ?? null, statusLocation: status.StatusLocation ?? null,
        instructions: status.Instructions ?? null, scannedAt,
      }, requestId);
    }
    await admin.from("webhook_events").update({ status: "processed", processed_at: new Date().toISOString() }).eq("event_key", eventKey);
    return { received: true, duplicate: false, handled };
  } catch (processingError) {
    await admin.from("webhook_events").update({
      status: "failed", last_error: processingError instanceof Error ? processingError.message.slice(0, 500) : "Webhook processing failed",
    }).eq("event_key", eventKey);
    throw new ApiError(503, "WEBHOOK_PROCESSING_FAILED", "The Delhivery webhook could not be processed.");
  }
}

/** Streams back Delhivery's packing-slip response verbatim (format is whatever
 * Delhivery serves -- see the note on features/delhivery/client.ts#fetchPackingSlip). */
export async function getShipmentLabel(orderId: string) {
  const shipment = await getShipmentForOrder(orderId);
  if (!shipment) throw new ApiError(404, "NOT_FOUND", "This order has no Delhivery shipment.");
  return fetchPackingSlip([shipment.waybill]);
}

export async function requestPickup(input: PickupRequestInput, actor: AuthContext, requestId: string) {
  try {
    const result = await createPickupRequest(input);
    await writeAudit(actor, "pickup.request", null, null, { input, result }, requestId);
    return result;
  } catch (pickupError) {
    // Delhivery allows only one open pickup request per warehouse at a time; a
    // second request while one is pending is a routine conflict, not an outage.
    if (pickupError instanceof ApiError && pickupError.cause instanceof Error && /already|pending|exist/i.test(pickupError.cause.message)) {
      throw new ApiError(409, "PICKUP_REQUEST_ACTIVE", "A pickup request for this warehouse is already open.");
    }
    throw pickupError;
  }
}
