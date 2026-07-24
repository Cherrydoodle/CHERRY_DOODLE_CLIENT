import { checkoutStartSchema } from "@/features/checkout/schemas";
import { startRazorpayCheckout } from "@/features/checkout/service";
import { optionalAuth } from "@/lib/auth/authorization";
import { clientIp } from "@/lib/http/client-ip";
import { withIdempotency } from "@/lib/http/idempotency";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function POST(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const subjectIp = clientIp(request);
    await enforceRateLimit({ scope: "checkout-start", subject: subjectIp, limit: 10, windowSeconds: 600 });
    const input = await readJson(request, checkoutStartSchema);
    const auth = await optionalAuth();
    const result = await withIdempotency({
      request,
      scope: "checkout.razorpay.start",
      subject: auth?.userId ?? subjectIp,
      payload: input,
      action: () => startRazorpayCheckout(input),
    });
    return jsonData(result, requestId, { status: 201 });
  });
}
