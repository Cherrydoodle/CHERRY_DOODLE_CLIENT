import { addCartItemSchema } from "@/features/cart/schemas";
import { addCartItem, clearCart } from "@/features/cart/service";
import { optionalAuth } from "@/lib/auth/authorization";
import { clientIp } from "@/lib/http/client-ip";
import { withIdempotency } from "@/lib/http/idempotency";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function POST(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    await enforceRateLimit({ scope: "cart", subject: clientIp(request), limit: 120, windowSeconds: 60 });
    const input = await readJson(request, addCartItemSchema);
    const auth = await optionalAuth();
    const result = await withIdempotency({
      request,
      scope: "cart.add-item",
      subject: auth?.userId ?? clientIp(request),
      payload: input,
      action: () => addCartItem(input.productVariantId, input.quantity),
    });
    return jsonData(result, requestId, { status: 201 });
  });
}

export async function DELETE(request: Request) {
  return handleRoute(request, async () => {
    assertSameOrigin(request);
    await clearCart();
    return new Response(null, { status: 204, headers: { "cache-control": "private, no-store" } });
  });
}
