import { offerCreateSchema } from "@/features/offers/schemas";
import { createOffer, listOffers } from "@/features/offers/service";
import { requirePermission } from "@/lib/auth/authorization";
import { withIdempotency } from "@/lib/http/idempotency";
import { assertSameOrigin, booleanParam, integerParam, readJson } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function GET(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    await requirePermission("catalog.write");
    const search = new URL(request.url).searchParams;
    const query = search.get("q")?.trim();
    const result = await listOffers({
      includeDeleted: booleanParam(search.get("includeDeleted")), query: query ? query.slice(0, 100) : undefined,
      page: integerParam(search.get("page"), 1, 1, 100_000), limit: integerParam(search.get("limit"), 50, 1, 200),
    });
    return jsonData(result, requestId);
  });
}

export async function POST(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requirePermission("catalog.write");
    const input = await readJson(request, offerCreateSchema);
    const result = await withIdempotency({ request, scope: "admin.offer.create", subject: actor.userId, payload: input, action: () => createOffer(input, actor, requestId) });
    return jsonData(result, requestId, { status: 201 });
  });
}
