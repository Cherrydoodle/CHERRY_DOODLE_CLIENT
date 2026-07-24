import "server-only";

import { z } from "zod";

import { ApiError } from "@/lib/http/problem";

export const MAX_BODY_BYTES = 1_000_000;

// Reads the body while enforcing a hard byte ceiling as bytes arrive, so a chunked
// request that omits `content-length` (and thus slips past a header-only check) still
// cannot make us buffer an unbounded body. Returns the raw text; callers that need
// JSON parse it themselves. The `content-length` fast-path below still rejects
// oversized bodies before a single byte is read when the header is present and honest.
export async function readLimitedText(request: Request, maxBytes = MAX_BODY_BYTES): Promise<string> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
  }

  const body = request.body;
  if (!body) return "";

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export async function readJson<TSchema extends z.ZodType>(request: Request, schema: TSchema): Promise<z.output<TSchema>> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") throw new ApiError(400, "BAD_REQUEST", "Content-Type must be application/json.");

  const text = await readLimitedText(request);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiError(400, "BAD_REQUEST", "Request body must be valid JSON.");
  }
  return schema.parse(body);
}

export function assertSameOrigin(request: Request) {
  // Bearer-token-authenticated requests are not a CSRF vector and are exempt from
  // the same-origin check: a browser never auto-attaches an Authorization header on
  // a cross-origin request, and CORS blocks a malicious page from setting one, so
  // there is no ambient credential to forge. This is exactly how the separate admin
  // panel (cherry_doodle_admin_panel) reaches these routes -- its server-side proxy
  // calls them with `Authorization: Bearer <supabase access token>` and no Origin
  // header (a server-to-server fetch has none). The same-origin check exists to
  // protect COOKIE-authenticated browser requests (cart, wishlist, checkout, /me),
  // which never carry a bearer token.
  const authorization = request.headers.get("authorization");
  if (authorization && /^Bearer\s+.+/i.test(authorization)) return;

  // For cookie-authenticated requests, a missing Origin is rejected (not allowed
  // through): a legitimate same-origin browser fetch always sends Origin on
  // unsafe-method requests. Routes with a different trust model (the Razorpay
  // webhook, verified by HMAC signature; cron jobs, verified by CRON_SECRET) never
  // call this function, so they are unaffected.
  const origin = request.headers.get("origin");
  if (!origin) throw new ApiError(403, "CSRF_FAILED", "The request origin is not allowed.");
  const expected = new URL(request.url).origin;
  if (origin !== expected) throw new ApiError(403, "CSRF_FAILED", "The request origin is not allowed.");
}

export function booleanParam(value: string | null, fallback = false) {
  if (value === null) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new ApiError(422, "VALIDATION_ERROR", "Boolean query parameters must be true or false.");
}

export function integerParam(value: string | null, fallback: number, min: number, max: number) {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ApiError(422, "VALIDATION_ERROR", `Value must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}
