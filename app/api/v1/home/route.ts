import { getHome } from "@/features/catalog/repository";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function GET(request: Request) {
  return handleRoute(request, async ({ requestId }) => jsonData(await getHome(), requestId, {
    headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" },
  }));
}
