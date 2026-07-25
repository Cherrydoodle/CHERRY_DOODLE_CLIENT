import { checkoutVerifySchema } from "@/features/checkout/schemas";
import { verifyAndCompleteRazorpayCheckout } from "@/features/checkout/service";
import { clientIp } from "@/lib/http/client-ip";
import { withIdempotency } from "@/lib/http/idempotency";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function POST(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    // A coarse per-IP ceiling (shared carrier-grade-NAT addresses must not throttle
    // unrelated customers) plus a tight per-checkout one, which is what actually
    // bounds brute-force attempts against a single session's signature.
    await enforceRateLimit({ scope: "checkout-verify-ip", subject: clientIp(request), limit: 300, windowSeconds: 600 });
    const input = await readJson(request, checkoutVerifySchema);
    await enforceRateLimit({ scope: "checkout-verify", subject: input.checkoutId, limit: 30, windowSeconds: 600 });
    const result = await withIdempotency({
      request,
      scope: "checkout.razorpay.verify",
      subject: input.checkoutId,
      payload: input,
      action: () => verifyAndCompleteRazorpayCheckout(input),
    });
    return jsonData(result, requestId);
  });
}
