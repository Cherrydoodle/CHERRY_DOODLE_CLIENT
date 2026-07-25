import "server-only";

import { requireResendConfig } from "@/lib/env.server";
import { ApiError } from "@/lib/http/problem";

const API_BASE_URL = "https://api.resend.com";

export type ResendMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Scopes the send so a retried delivery (the outbox re-runs a row whose HTTP
   * call timed out) cannot produce a second copy in the customer's inbox. Resend
   * recommends an `<event-type>/<entity-id>` shape; we pass the outbox row id.
   */
  idempotencyKey: string;
};

// Errors Resend will keep rejecting no matter how many times the outbox retries: a
// revoked key, a malformed payload, a bad endpoint. Marking these permanent stops a
// poison message from consuming a retry slot forever.
//
// 403 is deliberately NOT here. Resend returns it while a sending domain is still
// unverified, which is a configuration state that resolves on its own once DNS
// propagates — treating it as permanent would silently and irreversibly drop the
// order confirmations for every purchase made in that window. It still gets parked
// after MAX_ATTEMPTS if it really never resolves.
const PERMANENT_STATUSES = new Set([400, 401, 404, 422]);

export class EmailSendError extends Error {
  constructor(message: string, public readonly permanent: boolean) {
    super(message);
    this.name = "EmailSendError";
  }
}

/**
 * Sends one transactional email through Resend. The sending domain is
 * cherrydoodle.in and must be DNS-verified in the Resend dashboard.
 *
 * Never throws ApiError: this runs inside the email-dispatch cron, which records
 * the failure on the outbox row and retries with backoff.
 */
export async function sendResendEmail(message: ResendMessage): Promise<{ id: string }> {
  const { apiKey, from, replyTo } = requireResendConfig();

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/emails`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": message.idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new EmailSendError("Resend could not be reached.", false);
  }

  const body = (await response.json().catch(() => null)) as { id?: string; message?: string; name?: string } | null;
  if (!response.ok) {
    const detail = body?.message?.slice(0, 300) || `Resend returned ${response.status}`;
    throw new EmailSendError(detail, PERMANENT_STATUSES.has(response.status));
  }
  if (!body?.id) throw new EmailSendError("Resend accepted the request but returned no message id.", false);
  return { id: body.id };
}

// Surfaced by the admin/health tooling so a misconfigured mail setup is visible
// before a customer's order confirmation silently fails.
export function assertResendConfigured() {
  try {
    requireResendConfig();
    return true;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return false;
  }
}
