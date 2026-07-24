import { cartItemIdSchema, updateCartItemSchema } from "@/features/cart/schemas";
import { removeCartItem, setCartItemQuantity } from "@/features/cart/service";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function PATCH(request: Request, context: { params: Promise<{ itemId: string }> }) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const { itemId } = await context.params;
    const input = await readJson(request, updateCartItemSchema);
    return jsonData(await setCartItemQuantity(cartItemIdSchema.parse(itemId), input.quantity), requestId);
  });
}

export async function DELETE(request: Request, context: { params: Promise<{ itemId: string }> }) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const { itemId } = await context.params;
    return jsonData(await removeCartItem(cartItemIdSchema.parse(itemId)), requestId);
  });
}
