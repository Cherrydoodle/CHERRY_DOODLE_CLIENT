import { mergeWishlistSchema } from "@/features/wishlist/schemas";
import { mergeWishlist } from "@/features/wishlist/service";
import { requireUser } from "@/lib/auth/authorization";
import { withIdempotency } from "@/lib/http/idempotency";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function POST(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requireUser();
    const { productIds } = await readJson(request, mergeWishlistSchema);
    const result = await withIdempotency({ request, scope: "wishlist.merge", subject: actor.userId, payload: { productIds }, action: () => mergeWishlist(productIds) });
    return jsonData(result, requestId);
  });
}
