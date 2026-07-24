import { listProducts } from "@/features/catalog/repository";
import { parseProductFilters } from "@/features/catalog/schemas";
import { handleRoute, jsonList } from "@/lib/http/route";

export async function GET(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    const result = await listProducts(parseProductFilters(new URL(request.url)));
    return jsonList(result.items, requestId, { total: result.total, nextCursor: result.nextCursor });
  });
}
