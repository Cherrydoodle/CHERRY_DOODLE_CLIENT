import { timingSafeEqual } from "node:crypto";

import { requireDelhiveryWebhookSecret } from "@/lib/env.server";
import { processDelhiveryPush } from "@/features/delhivery/service";
import { clientIp } from "@/lib/http/client-ip";
import { ApiError } from "@/lib/http/problem";
import { readLimitedText } from "@/lib/http/request";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { handleRoute, jsonData } from "@/lib/http/route";

// Delhivery's tracking push carries no signature of its own (unlike Razorpay's
// HMAC), so a shared bearer secret is the only thing standing between the internet
// and the order state machine. Accepts `_PREVIOUS` during a secret rotation, same
// overlap rationale as the Razorpay webhook secret.
function assertDelhiveryWebhookAuthorized(request: Request) {
  const { current, previous } = requireDelhiveryWebhookSecret();
  const supplied = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!supplied) throw new ApiError(401, "AUTH_REQUIRED", "A valid webhook credential is required.");

  const suppliedBytes = Buffer.from(supplied, "utf8");
  const matches = (secret: string) => {
    const secretBytes = Buffer.from(secret, "utf8");
    return secretBytes.length === suppliedBytes.length && timingSafeEqual(secretBytes, suppliedBytes);
  };
  if (matches(current) || (previous && matches(previous))) return;
  throw new ApiError(401, "AUTH_REQUIRED", "A valid webhook credential is required.");
}

export async function POST(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    await enforceRateLimit({ scope: "delhivery-webhook", subject: clientIp(request), limit: 600, windowSeconds: 60 });
    assertDelhiveryWebhookAuthorized(request);
    const rawBody = await readLimitedText(request);
    return jsonData(await processDelhiveryPush(rawBody, requestId), requestId);
  });
}
