import { productIdSchema } from "@/features/wishlist/schemas";
import { addWishlistItem, removeWishlistItem } from "@/features/wishlist/service";
import { assertSameOrigin } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function PUT(request: Request, context: { params: Promise<{ productId: string }> }) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const { productId } = await context.params;
    return jsonData(await addWishlistItem(productIdSchema.parse(productId)), requestId);
  });
}

export async function DELETE(request: Request, context: { params: Promise<{ productId: string }> }) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const { productId } = await context.params;
    return jsonData(await removeWishlistItem(productIdSchema.parse(productId)), requestId);
  });
}
