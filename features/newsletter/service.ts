import "server-only";

import { createHash, createHmac, randomBytes } from "node:crypto";

import { requireHmacSecret } from "@/lib/env.server";
import { ApiError } from "@/lib/http/problem";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function privateValueHash(value: string) {
  return createHmac("sha256", requireHmacSecret()).update(value).digest("hex");
}

export async function subscribeNewsletter(email: string, source: string, baseUrl: string, ip: string | null) {
  const admin = createAdminSupabaseClient();
  const { data: existing, error: lookupError } = await admin.from("newsletter_subscriptions").select("id,status,updated_at").eq("email", email).maybeSingle();
  if (lookupError) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Newsletter signup is temporarily unavailable.");
  if (existing?.status === "active" || existing?.status === "suppressed") return { accepted: true as const };

  const confirmationToken = randomBytes(32).toString("base64url");
  const unsubscribeToken = randomBytes(32).toString("base64url");
  const record = {
    email, source, status: "pending", confirmation_token_hash: tokenHash(confirmationToken), unsubscribe_token_hash: tokenHash(unsubscribeToken),
    last_ip_hash: ip ? privateValueHash(ip) : null, unsubscribed_at: null,
  };
  const { data: subscription, error } = existing
    ? await admin.from("newsletter_subscriptions").update(record).eq("id", existing.id).select("id").single()
    : await admin.from("newsletter_subscriptions").insert(record).select("id").single();
  if (error || !subscription) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Newsletter signup is temporarily unavailable.");

  const confirmUrl = new URL("/api/v1/newsletter/confirm", baseUrl);
  confirmUrl.searchParams.set("token", confirmationToken);
  const unsubscribeUrl = new URL("/newsletter/unsubscribe", baseUrl);
  unsubscribeUrl.searchParams.set("token", unsubscribeToken);
  const { error: outboxError } = await admin.from("email_outbox").insert({
    message_type: "newsletter_confirmation",
    recipient_email: email,
    payload: { subscriptionId: subscription.id, confirmUrl: confirmUrl.toString(), unsubscribeUrl: unsubscribeUrl.toString() },
  });
  if (outboxError) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Newsletter confirmation could not be queued.");
  return { accepted: true as const };
}

export async function confirmNewsletter(token: string) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.from("newsletter_subscriptions").update({ status: "active", confirmed_at: new Date().toISOString(), confirmation_token_hash: null }).eq("confirmation_token_hash", tokenHash(token)).eq("status", "pending").select("id").maybeSingle();
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Newsletter confirmation is temporarily unavailable.");
  return Boolean(data);
}

export async function unsubscribeNewsletter(token: string) {
  const admin = createAdminSupabaseClient();
  await admin.from("newsletter_subscriptions").update({ status: "unsubscribed", unsubscribed_at: new Date().toISOString(), confirmation_token_hash: null }).eq("unsubscribe_token_hash", tokenHash(token));
}

export async function dispatchEmailOutbox(limit = 20) {
  const providerUrl = process.env.EMAIL_PROVIDER_API_URL;
  const providerKey = process.env.EMAIL_PROVIDER_API_KEY;
  if (!providerUrl || !providerKey) return { configured: false, sent: 0, failed: 0 };
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.from("email_outbox").select("id,message_type,recipient_email,payload,attempts").in("status", ["pending", "failed"]).lte("next_attempt_at", new Date().toISOString()).order("created_at").limit(limit);
  if (error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Email queue could not be loaded.");
  let sent = 0;
  let failed = 0;
  for (const message of data ?? []) {
    const claimed = await admin.from("email_outbox").update({ status: "processing" }).eq("id", message.id).in("status", ["pending", "failed"]).select("id").maybeSingle();
    if (!claimed.data) continue;
    try {
      const response = await fetch(providerUrl, {
        method: "POST", headers: { authorization: `Bearer ${providerKey}`, "content-type": "application/json" },
        body: JSON.stringify({ type: message.message_type, to: message.recipient_email, data: message.payload }),
        signal: AbortSignal.timeout(10_000), cache: "no-store",
      });
      if (!response.ok) throw new Error(`Provider returned ${response.status}`);
      await admin.from("email_outbox").update({ status: "sent", sent_at: new Date().toISOString(), last_error: null }).eq("id", message.id);
      sent += 1;
    } catch (error_) {
      const attempts = Number(message.attempts) + 1;
      await admin.from("email_outbox").update({ status: "failed", attempts, last_error: error_ instanceof Error ? error_.message.slice(0, 500) : "Unknown error", next_attempt_at: new Date(Date.now() + Math.min(3600, 2 ** attempts * 30) * 1000).toISOString() }).eq("id", message.id);
      failed += 1;
    }
  }
  return { configured: true, sent, failed };
}
