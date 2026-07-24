import { moveWishlistSchema, productIdSchema } from "@/features/wishlist/schemas";
import { moveWishlistItemToCart } from "@/features/wishlist/service";
import { requireUser } from "@/lib/auth/authorization";
import { withIdempotency } from "@/lib/http/idempotency";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function POST(request: Request, context: { params: Promise<{ productId: string }> }) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requireUser();
    const { productId } = await context.params;
    const input = await readJson(request, moveWishlistSchema);
    const validatedProductId = productIdSchema.parse(productId);
    const result = await withIdempotency({
      request,
      scope: "wishlist.move-to-cart",
      subject: actor.userId,
      payload: { productId: validatedProductId, ...input },
      action: () => moveWishlistItemToCart(validatedProductId, input.productVariantId, input.quantity ?? 1),
    });
    return jsonData(result, requestId);
  });
}
