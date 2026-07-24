import "server-only";

import { createRazorpayRefund, type RazorpayRefund } from "@/features/checkout/razorpay";
import type { CustomerCancelInput, CustomerReturnRequestInput, IssueRefundInput, ResolveReturnInput } from "@/features/refunds/schemas";
import type { AuthContext } from "@/lib/auth/authorization";
import { requireUser } from "@/lib/auth/authorization";
import { ApiError } from "@/lib/http/problem";
import { logger } from "@/lib/observability/logger";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

// Refunds/returns are a new capability layered on top of the existing, audited
// payment engine (order creation, /verify, webhook signature handling) — none of
// that is modified here. Refund money-movement is reserved via the
// create_refund_record RPC (row-locked, enforces amount <= captured) before the
// Razorpay API is ever called, mirroring complete_razorpay_checkout's style.

type PaymentAttemptRow = {
  id: string;
  provider_payment_id: string;
  amount_minor: number;
  currency: string;
};

// S10: an admin mutation that cannot be audited must not silently report success.
// For refund/return actions specifically this matters most -- these move money or
// change fulfilment state, so a broken audit trail here is the worst case to miss.
async function writeAudit(actor: AuthContext, action: string, resourceId: string, before: unknown, after: unknown, requestId: string) {
  const { error } = await createAdminSupabaseClient().from("audit_logs").insert({
    actor_user_id: actor.userId, actor_role: actor.role, action, resource_type: "order",
    resource_id: resourceId, before_data: before ?? null, after_data: after ?? null, request_id: requestId,
  });
  if (error) {
    logger.error("audit_log_write_failed", { action, resourceId, requestId, errorCode: error.code });
    throw new ApiError(503, "AUDIT_LOG_FAILED", "The action succeeded but could not be recorded in the audit trail. Please verify and retry if needed.");
  }
}

async function findCapturedPaymentAttempt(orderId: string): Promise<PaymentAttemptRow> {
  const admin = createAdminSupabaseClient();
  const { data: session } = await admin.from("checkout_sessions").select("id").eq("order_id", orderId).maybeSingle();
  if (!session) throw new ApiError(404, "PAYMENT_NOT_FOUND", "No payment record was found for this order.");
  const { data: attempt } = await admin
    .from("payment_attempts")
    .select("id,provider_payment_id,amount_minor,currency")
    .eq("checkout_session_id", session.id)
    .eq("status", "captured")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!attempt) throw new ApiError(404, "PAYMENT_NOT_FOUND", "No captured payment was found for this order.");
  return attempt as PaymentAttemptRow;
}

function mapRpcError(error: { message: string } | null): never {
  const message = error?.message ?? "";
  if (message.includes("REFUND_EXCEEDS_CAPTURED")) throw new ApiError(409, "REFUND_EXCEEDS_CAPTURED", "The refund amount exceeds what remains available to refund.");
  if (message.includes("PAYMENT_NOT_CAPTURED")) throw new ApiError(409, "PAYMENT_NOT_CAPTURED", "This payment is not eligible for a refund.");
  if (message.includes("PAYMENT_ATTEMPT_NOT_FOUND") || message.includes("ORDER_NOT_FOUND")) throw new ApiError(404, "NOT_FOUND", "Order or payment not found.");
  if (message.includes("REFUND_AMOUNT_INVALID")) throw new ApiError(422, "VALIDATION_ERROR", "The refund amount must be greater than zero.");
  if (message.includes("RETURN_ALREADY_REQUESTED")) throw new ApiError(409, "RETURN_ALREADY_REQUESTED", "A return has already been requested for this order.");
  if (message.includes("ORDER_NOT_DELIVERED")) throw new ApiError(409, "ORDER_NOT_DELIVERED", "Only delivered orders can be returned.");
  if (message.includes("RETURN_NOT_PENDING")) throw new ApiError(409, "RETURN_NOT_PENDING", "This order does not have a pending return request.");
  if (message.includes("RETURN_NOT_APPROVED")) throw new ApiError(409, "RETURN_NOT_APPROVED", "This return has not been approved yet.");
  if (message.includes("INVALID_ORDER_TRANSITION")) throw new ApiError(409, "INVALID_ORDER_TRANSITION", "This order cannot be cancelled in its current state.");
  if (message.includes("VERSION_CONFLICT")) throw new ApiError(409, "VERSION_CONFLICT", "This order was changed by someone else. Refresh and try again.");
  throw new ApiError(503, "SERVICE_UNAVAILABLE", "The request could not be completed.");
}

// Admin-only. Reserves the refund amount in the DB first (row-locked, enforces
// amount <= captured), then calls Razorpay, then syncs the outcome. If Razorpay
// itself fails after the reservation was made, the reservation is marked 'failed'
// so it never blocks a legitimate subsequent refund.
export async function issueRefund(orderId: string, input: IssueRefundInput, actor: AuthContext, requestId: string) {
  const admin = createAdminSupabaseClient();
  const paymentAttempt = await findCapturedPaymentAttempt(orderId);

  const reserved = await admin.rpc("create_refund_record", {
    p_order_id: orderId,
    p_payment_attempt_id: paymentAttempt.id,
    p_amount_minor: input.amountMinor,
    p_reason: input.reason,
    p_initiated_by: actor.userId,
  });
  if (reserved.error || !reserved.data) mapRpcError(reserved.error);
  const refundRow = reserved.data as { id: string };

  let providerRefund: RazorpayRefund;
  try {
    providerRefund = await createRazorpayRefund({
      paymentId: paymentAttempt.provider_payment_id,
      amount: input.amountMinor,
      idempotencyKey: refundRow.id,
      notes: { order_id: orderId, refund_id: refundRow.id },
    });
  } catch (error) {
    await admin.from("refunds").update({
      status: "failed",
      error_description: error instanceof ApiError ? error.message.slice(0, 1000) : "Razorpay refund request failed.",
    }).eq("id", refundRow.id);
    await writeAudit(actor, "refund.failed", orderId, null, { refundId: refundRow.id, amountMinor: input.amountMinor }, requestId);
    throw error;
  }

  await admin.from("refunds").update({ razorpay_refund_id: providerRefund.id }).eq("id", refundRow.id);

  if (providerRefund.status === "processed" || providerRefund.status === "failed") {
    const sync = await admin.rpc("mark_refund_processed", {
      p_razorpay_refund_id: providerRefund.id,
      p_status: providerRefund.status,
      p_error_description: null,
    });
    if (sync.error) logger.error("refund_status_sync_failed", { refundId: refundRow.id, providerRefundId: providerRefund.id, requestId });
  }
  // A 'pending' provider status is resolved later by the refund.* webhook — this
  // mirrors how payment capture is confirmed synchronously in /verify but also
  // recovered asynchronously by the payment webhook if the callback is lost.

  await writeAudit(actor, "refund.issued", orderId, null, {
    refundId: refundRow.id, razorpayRefundId: providerRefund.id, amountMinor: input.amountMinor, status: providerRefund.status,
  }, requestId);

  return { refundId: refundRow.id, razorpayRefundId: providerRefund.id, status: providerRefund.status, amountMinor: input.amountMinor };
}

export async function resolveOrderReturn(orderId: string, input: ResolveReturnInput, actor: AuthContext, requestId: string) {
  const admin = createAdminSupabaseClient();
  const result = await admin.rpc("resolve_order_return", {
    p_order_id: orderId,
    p_decision: input.decision,
    p_actor_id: actor.userId,
    p_note: input.note ?? null,
  });
  if (result.error || !result.data) mapRpcError(result.error);
  await writeAudit(actor, `return.${input.decision}`, orderId, null, { note: input.note ?? null }, requestId);
  return result.data;
}

export async function markOrderReturned(orderId: string, actor: AuthContext, requestId: string) {
  const admin = createAdminSupabaseClient();
  const result = await admin.rpc("mark_order_returned", { p_order_id: orderId, p_actor_id: actor.userId });
  if (result.error || !result.data) mapRpcError(result.error);
  await writeAudit(actor, "return.received", orderId, null, null, requestId);
  return result.data;
}

// Customer-facing: request cancellation of a not-yet-dispatched order (own order
// only — requireUser() + explicit ownership check before calling the shared
// transition_order_status RPC that admin order management already uses).
export async function cancelMyOrder(orderId: string, input: CustomerCancelInput) {
  const auth = await requireUser();
  const admin = createAdminSupabaseClient();
  const { data: order, error } = await admin.from("orders").select("id,version,status,customer_user_id").eq("id", orderId).eq("customer_user_id", auth.userId).is("deleted_at", null).maybeSingle();
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "The order could not be loaded.");
  if (!order) throw new ApiError(404, "NOT_FOUND", "Order not found.");

  const result = await admin.rpc("transition_order_status", {
    p_order_id: orderId,
    p_expected_version: order.version,
    p_new_status: "cancelled",
    p_actor_id: auth.userId,
    p_reason: input.reason ? `Customer requested cancellation: ${input.reason}`.slice(0, 500) : "Customer requested cancellation",
  });
  if (result.error || !result.data) mapRpcError(result.error);
  return result.data;
}

// Customer-facing: request a return on a delivered order they own.
export async function requestMyOrderReturn(orderId: string, input: CustomerReturnRequestInput) {
  const auth = await requireUser();
  const admin = createAdminSupabaseClient();
  const result = await admin.rpc("request_order_return", { p_order_id: orderId, p_customer_id: auth.userId, p_reason: input.reason });
  if (result.error || !result.data) mapRpcError(result.error);
  return result.data;
}

// Called from the refund.* webhook branch (features/checkout/service.ts). Only
// syncs when Razorpay reports a terminal outcome; 'pending' is left as-is until a
// later event confirms it.
export async function processRefundWebhookEvent(entity: { id: string; status: string }) {
  if (entity.status !== "processed" && entity.status !== "failed") return;
  const admin = createAdminSupabaseClient();
  const result = await admin.rpc("mark_refund_processed", {
    p_razorpay_refund_id: entity.id,
    p_status: entity.status,
    p_error_description: entity.status === "failed" ? "Reported failed by Razorpay webhook." : null,
  });
  if (result.error) {
    // A refund the webhook references but that we have no record of (e.g. a
    // refund created directly in the Razorpay dashboard, outside this app) is
    // not an application error — nothing to reconcile locally.
    if (!result.error.message.includes("REFUND_NOT_FOUND")) {
      logger.error("refund_webhook_sync_failed", { razorpayRefundId: entity.id, status: entity.status, errorMessage: result.error.message });
    }
  }
}
