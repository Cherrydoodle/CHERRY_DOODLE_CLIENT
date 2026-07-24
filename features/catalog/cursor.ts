import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { isProduction } from "@/lib/env.server";
import { ApiError } from "@/lib/http/problem";

function secret() {
  const value = process.env.APP_HMAC_SECRET;
  if (!value && isProduction()) throw new ApiError(503, "SERVICE_UNAVAILABLE", "Cursor signing is not configured.");
  return value ?? "cherry-doodle-local-development-only";
}

function signature(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function encodeCursor(offset: number) {
  const payload = Buffer.from(JSON.stringify({ v: 1, offset })).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function decodeCursor(cursor?: string) {
  if (!cursor) return 0;
  const [payload, suppliedSignature, extra] = cursor.split(".");
  if (!payload || !suppliedSignature || extra) throw new ApiError(400, "INVALID_CURSOR", "The pagination cursor is invalid.");
  const expected = signature(payload);
  const suppliedBuffer = Buffer.from(suppliedSignature);
  const expectedBuffer = Buffer.from(expected);
  if (suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) {
    throw new ApiError(400, "INVALID_CURSOR", "The pagination cursor is invalid.");
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { v?: unknown; offset?: unknown };
    if (parsed.v !== 1 || !Number.isInteger(parsed.offset) || Number(parsed.offset) < 0 || Number(parsed.offset) > 1_000_000) throw new Error();
    return Number(parsed.offset);
  } catch {
    throw new ApiError(400, "INVALID_CURSOR", "The pagination cursor is invalid.");
  }
}
