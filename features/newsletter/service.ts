import "server-only";

import { createHash, createHmac, randomBytes } from "node:crypto";

import { enqueueEmail } from "@/features/email/service";
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
  const queued = await enqueueEmail("newsletter_confirmation", email, {
    subscriptionId: subscription.id,
    confirmUrl: confirmUrl.toString(),
    unsubscribeUrl: unsubscribeUrl.toString(),
  });
  if (!queued) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Newsletter confirmation could not be queued.");
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

// The outbox dispatcher moved to features/email/service.ts when Resend replaced the
// generic provider webhook — it now serves order confirmations too, not just this
// feature's confirmation mail.
