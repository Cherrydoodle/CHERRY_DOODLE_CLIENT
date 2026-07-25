import { checkoutConfirmationSchema } from "@/features/checkout/schemas";
import { cancelRazorpayCheckout } from "@/features/checkout/service";
import { clientIp } from "@/lib/http/client-ip";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { handleRoute, jsonData } from "@/lib/http/route";

// Called when the shopper dismisses the Razorpay modal or leaves the checkout page,
// so their reserved stock is freed immediately instead of after the 20-minute sweep.
// Naturally idempotent (release_checkout_inventory no-ops once the session is no
// longer active), so unlike /order and /verify it needs no Idempotency-Key — which
// also lets the browser fire it via sendBeacon on pagehide.
export async function POST(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    await enforceRateLimit({ scope: "checkout-cancel", subject: clientIp(request), limit: 60, windowSeconds: 600 });
    const input = await readJson(request, checkoutConfirmationSchema);
    return jsonData(await cancelRazorpayCheckout(input), requestId);
  });
}
