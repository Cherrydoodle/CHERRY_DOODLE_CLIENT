import "server-only";

import { createHash, createHmac } from "node:crypto";

import { requireHmacSecret } from "@/lib/env.server";
import { ApiError } from "@/lib/http/problem";
import { logger } from "@/lib/observability/logger";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

type Options<T> = {
  request: Request;
  scope: string;
  subject: string;
  payload: unknown;
  action: () => Promise<T>;
};

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function withIdempotency<T>({ request, scope, subject, payload, action }: Options<T>): Promise<T> {
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key || !/^[A-Za-z0-9._:-]{8,100}$/.test(key)) {
    throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.");
  }

  const subjectHash = createHmac("sha256", requireHmacSecret()).update(subject).digest("hex");
  const requestHash = digest(JSON.stringify(payload));
  const admin = createAdminSupabaseClient();
  const claim = await admin.from("idempotency_keys").insert({
    scope,
    subject_hash: subjectHash,
    key,
    request_hash: requestHash,
    expires_at: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
  });

  if (claim.error) {
    if (claim.error.code !== "23505") throw new ApiError(503, "SERVICE_UNAVAILABLE", "Request deduplication is temporarily unavailable.");
    const { data: existing, error } = await admin.from("idempotency_keys")
      .select("id,request_hash,response_body,expires_at")
      .eq("scope", scope)
      .eq("subject_hash", subjectHash)
      .eq("key", key)
      .maybeSingle();
    if (error || !existing) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Request deduplication is temporarily unavailable.");
    if (new Date(existing.expires_at).getTime() <= Date.now()) {
      const deletion = await admin.from("idempotency_keys").delete().eq("id", existing.id).lt("expires_at", new Date().toISOString());
      if (deletion.error) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Expired request metadata could not be renewed.");
      return withIdempotency({ request, scope, subject, payload, action });
    }
    if (existing.request_hash !== requestHash) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "That idempotency key was used with a different request.");
    if (existing.response_body === null) throw new ApiError(409, "REQUEST_IN_PROGRESS", "An identical request is still being processed.");
    return existing.response_body as T;
  }

  let value: T;
  try {
    value = await action();
  } catch (error) {
    await admin.from("idempotency_keys").delete().eq("scope", scope).eq("subject_hash", subjectHash).eq("key", key);
    throw error;
  }

  const { error } = await admin.from("idempotency_keys").update({ response_status: 200, response_body: value as never })
    .eq("scope", scope)
    .eq("subject_hash", subjectHash)
    .eq("key", key);
  if (error) logger.error("idempotency_response_store_failed", { scope, subjectHash, keyHash: digest(key), errorCode: error.code });
  return value;
}
