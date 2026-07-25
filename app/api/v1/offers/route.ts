import { listActiveOffers } from "@/features/offers/repository";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function GET(request: Request) {
  return handleRoute(request, async ({ requestId }) => jsonData(await listActiveOffers(), requestId, {
    headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=1800" },
  }));
}
