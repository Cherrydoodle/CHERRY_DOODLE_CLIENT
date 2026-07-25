import "server-only";

import { timingSafeEqual } from "node:crypto";

import { ApiError } from "@/lib/http/problem";

/**
 * Authorizes a scheduled-job request. Vercel Cron sends `Authorization: Bearer
 * <CRON_SECRET>` automatically when that variable is set on the project, and the
 * same header can be sent by any other scheduler.
 *
 * Compared in constant time so the secret cannot be recovered a byte at a time, and
 * factored out of the four job routes that previously each re-implemented the
 * check with a plain `!==` — one place to get right, not four to keep in sync.
 */
export function assertCronRequest(request: Request) {
  const unauthorized = new ApiError(401, "AUTH_REQUIRED", "Invalid job credentials.");
  const expected = process.env.CRON_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!expected || !supplied) throw unauthorized;

  const expectedBytes = Buffer.from(expected, "utf8");
  const suppliedBytes = Buffer.from(supplied, "utf8");
  if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) {
    throw unauthorized;
  }
}
