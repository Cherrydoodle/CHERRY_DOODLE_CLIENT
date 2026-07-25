import "server-only";

import { renderEmail } from "@/features/email/templates";
import { getStoreIdentity } from "@/features/store/identity";
import { EmailSendError, sendResendEmail } from "@/lib/email/resend";
import { ApiError } from "@/lib/http/problem";
import { logger } from "@/lib/observability/logger";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

// The transactional-email engine. `email_outbox` (202607140005_atomic_operations.sql)
// is the transactional outbox: writers only ever INSERT a row -- for order
// confirmations that INSERT happens inside complete_razorpay_checkout, in the same
// transaction that creates the order, so an order can never exist without its
// confirmation being queued. This dispatcher is the only thing that talks to Resend.

const MAX_ATTEMPTS = 8;

// email_outbox.status has no terminal-failure value, so a row we will never retry
// again is parked by pushing next_attempt_at far beyond any real dispatch window.
// The status stays 'failed' and last_error explains why, which keeps the row visible
// to an operator instead of silently disappearing.
const NEVER_RETRY_AT = "2999-01-01T00:00:00.000Z";

type OutboxRow = {
  id: string;
  message_type: string;
  recipient_email: string;
  payload: unknown;
  attempts: number;
};

/**
 * Queues a message for delivery. Best-effort by design: a caller in a payment path
 * must never fail the payment because the mail queue is unavailable, so failures
 * are logged and swallowed. Returns whether the row was written.
 */
export async function enqueueEmail(messageType: string, recipientEmail: string, payload: Record<string, unknown>) {
  const { error } = await createAdminSupabaseClient().from("email_outbox").insert({
    message_type: messageType,
    recipient_email: recipientEmail,
    payload,
  });
  if (error) {
    logger.error("email_enqueue_failed", { messageType, errorCode: error.code });
    return false;
  }
  return true;
}

async function parkPermanently(id: string, attempts: number, reason: string) {
  await createAdminSupabaseClient().from("email_outbox").update({
    status: "failed",
    attempts,
    last_error: `PERMANENT: ${reason}`.slice(0, 500),
    next_attempt_at: NEVER_RETRY_AT,
  }).eq("id", id);
}

/**
 * Drains the outbox through Resend. Invoked by
 * `POST /api/internal/jobs/email-dispatch` (CRON_SECRET-authenticated).
 *
 * Each row is claimed with a conditional UPDATE before any send, so two overlapping
 * cron runs cannot both send the same message. The Resend call additionally carries
 * an idempotency key derived from the row id, which covers the remaining window
 * where a send succeeds but our status write does not.
 */
export async function dispatchEmailOutbox(limit = 20) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("email_outbox")
    .select("id,message_type,recipient_email,payload,attempts")
    .in("status", ["pending", "failed"])
    .lte("next_attempt_at", new Date().toISOString())
    .order("created_at")
    .limit(limit);
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Email queue could not be loaded.");

  const rows = (data ?? []) as OutboxRow[];
  if (rows.length === 0) return { sent: 0, failed: 0, abandoned: 0 };

  const store = await getStoreIdentity();
  let sent = 0;
  let failed = 0;
  let abandoned = 0;

  for (const message of rows) {
    const claimed = await admin
      .from("email_outbox")
      .update({ status: "processing" })
      .eq("id", message.id)
      .in("status", ["pending", "failed"])
      .select("id")
      .maybeSingle();
    if (!claimed.data) continue;

    const rendered = renderEmail(message.message_type, message.payload, store);
    if (!rendered) {
      await parkPermanently(message.id, Number(message.attempts) + 1, `Unknown or unrenderable message type "${message.message_type}".`);
      logger.error("email_template_missing", { messageType: message.message_type, outboxId: message.id });
      abandoned += 1;
      continue;
    }

    try {
      await sendResendEmail({
        to: message.recipient_email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        idempotencyKey: `${message.message_type}/${message.id}`,
      });
      await admin.from("email_outbox").update({ status: "sent", sent_at: new Date().toISOString(), last_error: null }).eq("id", message.id);
      sent += 1;
    } catch (caught) {
      const attempts = Number(message.attempts) + 1;
      const reason = caught instanceof Error ? caught.message : "Unknown error";
      const permanent = caught instanceof EmailSendError && caught.permanent;
      if (permanent || attempts >= MAX_ATTEMPTS) {
        await parkPermanently(message.id, attempts, reason);
        logger.error("email_send_abandoned", { messageType: message.message_type, outboxId: message.id, attempts, permanent });
        abandoned += 1;
        continue;
      }
      await admin.from("email_outbox").update({
        status: "failed",
        attempts,
        last_error: reason.slice(0, 500),
        next_attempt_at: new Date(Date.now() + Math.min(3600, 2 ** attempts * 30) * 1000).toISOString(),
      }).eq("id", message.id);
      failed += 1;
    }
  }

  return { sent, failed, abandoned };
}
