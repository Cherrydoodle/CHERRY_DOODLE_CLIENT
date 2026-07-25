import "server-only";

import { fetchRazorpayOrderPayments, fetchRazorpayPayment } from "@/features/checkout/razorpay";
import { finalizeCapturedPayment, type CheckoutRecord } from "@/features/checkout/service";
import type { AcknowledgeReviewInput } from "@/features/admin-reconciliation/schemas";
import type { AuthContext } from "@/lib/auth/authorization";
import { ApiError } from "@/lib/http/problem";
import { logger } from "@/lib/observability/logger";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

// Admin visibility and recovery tooling for the payment engine's own
// "requires_review" escape hatch (features/checkout/service.ts). Nothing here
// changes how a payment is captured or verified -- it only reuses the exact same
// atomic order-creation path (finalizeCapturedPayment -> complete_razorpay_checkout)
// that already runs for every normal checkout, and reads/reports on records that
// path already writes.

// S10: an admin mutation that cannot be audited must not silently report success.
async function writeAudit(actor: AuthContext, action: string, resourceId: string, after: unknown, requestId: string) {
  const { error } = await createAdminSupabaseClient().from("audit_logs").insert({
    actor_user_id: actor.userId, actor_role: actor.role, action, resource_type: "checkout_session",
    resource_id: resourceId, before_data: null, after_data: after ?? null, request_id: requestId,
  });
  if (error) {
    logger.error("audit_log_write_failed", { action, resourceId, requestId, errorCode: error.code });
    throw new ApiError(503, "AUDIT_LOG_FAILED", "The action succeeded but could not be recorded in the audit trail. Please verify and retry if needed.");
  }
}

export type RequiresReviewItemDTO = {
  checkoutSessionId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  amountMinor: number;
  currency: string;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function listRequiresReviewQueue(page: number, limit: number) {
  const admin = createAdminSupabaseClient();
  const start = (page - 1) * limit;
  const { data, error, count } = await admin
    .from("checkout_sessions")
    .select("id,customer_name,customer_email,customer_phone,total_minor,currency,razorpay_order_id,razorpay_payment_id,created_at,updated_at", { count: "exact" })
    .eq("status", "requires_review")
    .is("resolved_at", null)
    .order("created_at", { ascending: true })
    .range(start, start + limit - 1);
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "The review queue could not be loaded.");

  const items: RequiresReviewItemDTO[] = (data ?? []).map((row) => ({
    checkoutSessionId: String(row.id),
    customerName: String(row.customer_name),
    customerEmail: String(row.customer_email),
    customerPhone: String(row.customer_phone),
    amountMinor: Number(row.total_minor),
    currency: String(row.currency),
    razorpayOrderId: row.razorpay_order_id ? String(row.razorpay_order_id) : null,
    razorpayPaymentId: row.razorpay_payment_id ? String(row.razorpay_payment_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }));
  return { items, total: count ?? 0, page, limit };
}

// Retries completing a stranded capture by re-fetching the payment from Razorpay
// (never trusting stored/stale data) and re-running the same order-creation path
// used by every normal checkout. Throws PAYMENT_REQUIRES_REVIEW again (harmless,
// idempotent) if the underlying issue (e.g. stock still unavailable) persists.
export async function retryRequiresReviewCompletion(checkoutSessionId: string, actor: AuthContext, requestId: string) {
  const admin = createAdminSupabaseClient();
  const { data: session, error } = await admin.from("checkout_sessions").select("*").eq("id", checkoutSessionId).maybeSingle();
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "The checkout session could not be loaded.");
  if (!session) throw new ApiError(404, "NOT_FOUND", "Checkout session not found.");
  if (session.status !== "requires_review") throw new ApiError(409, "NOT_REQUIRES_REVIEW", "This checkout session is not awaiting review.");
  if (!session.razorpay_payment_id) throw new ApiError(409, "PAYMENT_REFERENCE_MISSING", "No payment reference is recorded for this session.");

  const payment = await fetchRazorpayPayment(session.razorpay_payment_id);
  const order = await finalizeCapturedPayment(session as CheckoutRecord, payment);
  await writeAudit(actor, "requires_review.retried", checkoutSessionId, { orderId: order.id }, requestId);
  return order;
}

// For cases a retry cannot fix (e.g. the admin refunded the customer out of band
// via RZ-060 instead). Records the outcome without inventing a new terminal
// checkout_session_status -- it simply removes the item from the active queue.
export async function acknowledgeRequiresReview(checkoutSessionId: string, input: AcknowledgeReviewInput, actor: AuthContext, requestId: string) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("checkout_sessions")
    .update({ resolution_note: input.note, resolved_at: new Date().toISOString(), resolved_by: actor.userId })
    .eq("id", checkoutSessionId)
    .eq("status", "requires_review")
    .is("resolved_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "The checkout session could not be updated.");
  if (!data) throw new ApiError(404, "NOT_FOUND", "No unresolved review item found for this session.");
  await writeAudit(actor, "requires_review.acknowledged", checkoutSessionId, { note: input.note }, requestId);
  return { acknowledged: true as const };
}

export type ReconciliationMismatchDTO = {
  paymentAttemptId: string;
  checkoutSessionId: string;
  razorpayPaymentId: string;
  amountMinor: number;
  currency: string;
  checkoutSessionStatus: string;
  customerEmail: string;
  createdAt: string;
};

// Lists captured payments whose checkout session never reached 'completed' --
// i.e. money was taken but the DB has no order for it. Read-only, DB-side only
// (does not call Razorpay); the queue above is the primary work surface, this is
// a broader integrity check that would also catch anything the queue missed.
export async function getReconciliationReport(): Promise<{ staleCaptures: ReconciliationMismatchDTO[]; checkedCount: number }> {
  const admin = createAdminSupabaseClient();
  const { data: capturedAttempts, error } = await admin
    .from("payment_attempts")
    .select("id,checkout_session_id,provider_payment_id,amount_minor,currency,created_at")
    .eq("status", "captured")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "The reconciliation report could not be loaded.");
  if (!capturedAttempts || capturedAttempts.length === 0) return { staleCaptures: [], checkedCount: 0 };

  const sessionIds = [...new Set(capturedAttempts.map((row) => row.checkout_session_id as string))];
  const { data: sessions, error: sessionsError } = await admin
    .from("checkout_sessions")
    .select("id,status,customer_email")
    .in("id", sessionIds);
  if (sessionsError) throw new ApiError(503, "SERVICE_UNAVAILABLE", "The reconciliation report could not be loaded.");
  const sessionById = new Map((sessions ?? []).map((row) => [String(row.id), row]));

  const staleCaptures: ReconciliationMismatchDTO[] = [];
  for (const attempt of capturedAttempts) {
    const session = sessionById.get(String(attempt.checkout_session_id));
    if (session && session.status !== "completed") {
      staleCaptures.push({
        paymentAttemptId: String(attempt.id),
        checkoutSessionId: String(attempt.checkout_session_id),
        razorpayPaymentId: String(attempt.provider_payment_id),
        amountMinor: Number(attempt.amount_minor),
        currency: String(attempt.currency),
        checkoutSessionStatus: String(session.status),
        customerEmail: String(session.customer_email),
        createdAt: String(attempt.created_at),
      });
    }
  }
  return { staleCaptures, checkedCount: capturedAttempts.length };
}

// Cron entry point (RZ-070 deliberately deferred this here -- see TASKS.md).
// Recovers checkouts where BOTH the webhook and the client's /verify callback
// were lost, by asking Razorpay directly whether a payment exists for the order.
export async function runPaymentReconciliationSync(limit = 25) {
  const admin = createAdminSupabaseClient();
  const staleThreshold = new Date(Date.now() - 30 * 60_000).toISOString();
  const { data: stuckSessions, error } = await admin
    .from("checkout_sessions")
    .select("*")
    .eq("status", "payment_pending")
    .not("razorpay_order_id", "is", null)
    .lt("created_at", staleThreshold)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Stuck checkout sessions could not be loaded.");

  let recovered = 0;
  let stillPending = 0;
  const errors: string[] = [];

  for (const session of stuckSessions ?? []) {
    try {
      const payments = await fetchRazorpayOrderPayments(session.razorpay_order_id as string);
      // `authorized` counts as recoverable money, not as "still pending": the
      // account's auto-capture may be off, in which case finalizeCapturedPayment
      // captures the payment itself. Ignoring it here would leave the funds to be
      // auto-refunded by Razorpay days later with nothing recorded on our side.
      const recoverable =
        payments.items.find((item) => item.status === "captured" && item.captured) ??
        payments.items.find((item) => item.status === "authorized");
      if (!recoverable) {
        stillPending += 1;
        continue;
      }
      await finalizeCapturedPayment(session as CheckoutRecord, recoverable);
      recovered += 1;
    } catch (caught) {
      // Both of these are recoveries, not failures: the payment moved from
      // "silently lost" to either a flagged review item or a completed refund.
      if (caught instanceof ApiError && (caught.code === "PAYMENT_REQUIRES_REVIEW" || caught.code === "PAYMENT_AUTO_REFUNDED")) {
        recovered += 1;
        continue;
      }
      errors.push(caught instanceof Error ? caught.message.slice(0, 200) : "Unknown reconciliation error");
    }
  }
  return { examined: stuckSessions?.length ?? 0, recovered, stillPending, errors };
}
