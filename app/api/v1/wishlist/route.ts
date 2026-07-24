import { getWishlist } from "@/features/wishlist/service";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function GET(request: Request) {
  return handleRoute(request, async ({ requestId }) => jsonData(await getWishlist(), requestId));
}
