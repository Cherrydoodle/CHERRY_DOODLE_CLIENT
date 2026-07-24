import { claimGuestCart } from "@/features/cart/service";
import { requireUser } from "@/lib/auth/authorization";
import { withIdempotency } from "@/lib/http/idempotency";
import { assertSameOrigin } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function POST(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requireUser();
    const result = await withIdempotency({ request, scope: "cart.claim", subject: actor.userId, payload: {}, action: claimGuestCart });
    return jsonData(result, requestId);
  });
}
