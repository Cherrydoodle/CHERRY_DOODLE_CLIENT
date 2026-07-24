import { getCart } from "@/features/cart/service";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function GET(request: Request) {
  return handleRoute(request, async ({ requestId }) => jsonData(await getCart(), requestId));
}
