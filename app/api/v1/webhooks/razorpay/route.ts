import { processRazorpayWebhook } from "@/features/checkout/service";
import { validateRazorpayWebhook } from "@/features/checkout/razorpay";
import { clientIp } from "@/lib/http/client-ip";
import { ApiError } from "@/lib/http/problem";
import { readLimitedBytes } from "@/lib/http/request";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function POST(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    // Unauthenticated and internet-facing: without a bound, anyone can make this
    // endpoint read a 1 MB body and compute an HMAC on demand. The ceiling is far
    // above Razorpay's real delivery rate (including its retry storms), so a
    // legitimate burst is never throttled.
    await enforceRateLimit({ scope: "razorpay-webhook", subject: clientIp(request), limit: 600, windowSeconds: 60 });

    // readLimitedBytes enforces the byte ceiling as bytes arrive, so a chunked body
    // that omits content-length cannot bypass the size guard. The signature is
    // verified over the exact bytes received — decoding to text first would replace
    // invalid UTF-8 with U+FFFD and hash something Razorpay never sent.
    const rawBytes = await readLimitedBytes(request);
    if (!validateRazorpayWebhook(rawBytes, request.headers.get("x-razorpay-signature"))) {
      throw new ApiError(401, "INVALID_WEBHOOK_SIGNATURE", "Razorpay webhook signature is invalid.");
    }
    const rawBody = new TextDecoder().decode(rawBytes);

    // Passed through for log correlation only. It is NOT used for deduplication:
    // the header is outside the HMAC, so it is attacker-controllable on a replayed
    // body — processRazorpayWebhook keys on the hash of the signed bytes instead.
    const rawEventId = request.headers.get("x-razorpay-event-id")?.trim();
    const eventId = rawEventId && /^[A-Za-z0-9_-]{8,200}$/.test(rawEventId) ? rawEventId : null;
    return jsonData(await processRazorpayWebhook(rawBody, eventId, requestId), requestId);
  });
}
