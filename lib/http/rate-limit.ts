import "server-only";

import { createHash } from "node:crypto";

import { isProduction } from "@/lib/env.server";
import { ApiError } from "@/lib/http/problem";

type LimitOptions = { scope: string; subject: string; limit: number; windowSeconds: number };
const localWindows = new Map<string, { count: number; resetAt: number }>();

function subjectKey(options: LimitOptions) {
  return createHash("sha256").update(`${options.scope}:${options.subject}`).digest("hex");
}

export async function enforceRateLimit(options: LimitOptions) {
  const key = subjectKey(options);
  const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token) {
    const bucket = Math.floor(Date.now() / (options.windowSeconds * 1000));
    const redisKey = `ratelimit:${key}:${bucket}`;
    const response = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify([["INCR", redisKey], ["EXPIRE", redisKey, options.windowSeconds + 1]]),
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Rate limiting is temporarily unavailable.");
    const result = (await response.json()) as Array<{ result?: number }>;
    if ((result[0]?.result ?? 0) > options.limit) throw new ApiError(429, "RATE_LIMITED", "Too many requests. Try again later.");
    return;
  }

  if (isProduction()) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Distributed rate limiting is not configured.");
  const now = Date.now();
  const existing = localWindows.get(key);
  const window = !existing || existing.resetAt <= now ? { count: 0, resetAt: now + options.windowSeconds * 1000 } : existing;
  window.count += 1;
  localWindows.set(key, window);
  if (window.count > options.limit) throw new ApiError(429, "RATE_LIMITED", "Too many requests. Try again later.");
}
