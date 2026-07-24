import { processRazorpayWebhook } from "@/features/checkout/service";
import { validateRazorpayWebhook } from "@/features/checkout/razorpay";
import { ApiError } from "@/lib/http/problem";
import { readLimitedText } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function POST(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    // readLimitedText enforces the byte ceiling as bytes arrive, so a chunked body
    // that omits content-length cannot bypass the size guard. The exact raw text is
    // preserved for HMAC signature verification below.
    const rawBody = await readLimitedText(request);
    if (!validateRazorpayWebhook(rawBody, request.headers.get("x-razorpay-signature"))) {
      throw new ApiError(401, "INVALID_WEBHOOK_SIGNATURE", "Razorpay webhook signature is invalid.");
    }
    const eventId = request.headers.get("x-razorpay-event-id")?.trim();
    if (!eventId || !/^[A-Za-z0-9_-]{8,200}$/.test(eventId)) throw new ApiError(400, "BAD_REQUEST", "Razorpay event ID is missing or invalid.");
    return jsonData(await processRazorpayWebhook(rawBody, eventId, requestId), requestId);
  });
}
