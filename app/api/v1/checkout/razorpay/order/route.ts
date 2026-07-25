import { checkoutStartSchema } from "@/features/checkout/schemas";
import { startRazorpayCheckout } from "@/features/checkout/service";
import { optionalAuth } from "@/lib/auth/authorization";
import { clientIp } from "@/lib/http/client-ip";
import { withIdempotency } from "@/lib/http/idempotency";
import { ApiError } from "@/lib/http/problem";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function POST(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const subjectIp = clientIp(request);
    const auth = await optionalAuth();

    // Keyed on the signed-in user, not the IP. Checkout is login-gated, and a large
    // share of Indian mobile traffic shares one carrier-grade-NAT address — an
    // IP-keyed limit of 10 per 10 minutes throttles unrelated customers collectively.
    // A coarse per-IP ceiling still bounds unauthenticated/abusive bursts.
    await enforceRateLimit({ scope: "checkout-start-ip", subject: subjectIp, limit: 120, windowSeconds: 600 });
    if (!auth) throw new ApiError(401, "AUTH_REQUIRED", "Authentication is required.");
    await enforceRateLimit({ scope: "checkout-start", subject: auth.userId, limit: 10, windowSeconds: 600 });

    const input = await readJson(request, checkoutStartSchema);
    const result = await withIdempotency({
      request,
      scope: "checkout.razorpay.start",
      subject: auth.userId,
      payload: input,
      // The already-resolved caller is passed through so the access token is not
      // validated a second time inside the service.
      action: () => startRazorpayCheckout(input, auth),
    });
    return jsonData(result, requestId, { status: 201 });
  });
}
