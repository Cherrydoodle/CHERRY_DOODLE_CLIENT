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
    const subjectIp = clientIp(request);
    await enforceRateLimit({ scope: "checkout-verify", subject: subjectIp, limit: 30, windowSeconds: 600 });
    const input = await readJson(request, checkoutVerifySchema);
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
