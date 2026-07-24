import { listProducts } from "@/features/catalog/repository";
import { parseProductFilters } from "@/features/catalog/schemas";
import { clientIp } from "@/lib/http/client-ip";
import { ApiError } from "@/lib/http/problem";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { handleRoute, jsonList } from "@/lib/http/route";

export async function GET(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    const filters = parseProductFilters(new URL(request.url), true);
    if (!filters.q) throw new ApiError(422, "VALIDATION_ERROR", "Search query is required.");
    await enforceRateLimit({ scope: "search", subject: clientIp(request), limit: 60, windowSeconds: 60 });
    const result = await listProducts(filters);
    return jsonList(result.items, requestId, { total: result.total, nextCursor: result.nextCursor });
  });
}
