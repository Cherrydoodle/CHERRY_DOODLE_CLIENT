import { listCategories } from "@/features/catalog/repository";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function GET(request: Request) {
  return handleRoute(request, async ({ requestId }) => jsonData(await listCategories(), requestId, {
    headers: { "cache-control": "public, s-maxage=600, stale-while-revalidate=3600" },
  }));
}
