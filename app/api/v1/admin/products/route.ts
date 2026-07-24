import { z } from "zod";

import { productCreateCompleteSchema } from "@/features/admin/schemas";
import { createProduct, listAdminProducts } from "@/features/admin/service";
import { requirePermission } from "@/lib/auth/authorization";
import { withIdempotency } from "@/lib/http/idempotency";
import { assertSameOrigin, integerParam, readJson } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

const productStatus = z.enum(["draft", "published", "archived"]);

export async function GET(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    await requirePermission("catalog.write");
    const search = new URL(request.url).searchParams;
    const status = search.get("status");
    const query = search.get("q")?.trim();
    const categoryIds = search.get("categoryIds");
    const result = await listAdminProducts({
      status: status ? productStatus.parse(status) : undefined, query: query ? z.string().max(100).parse(query) : undefined,
      categoryIds: categoryIds ? z.array(z.string().uuid()).min(1).parse(categoryIds.split(",")) : undefined,
      page: integerParam(search.get("page"), 1, 1, 100_000), limit: integerParam(search.get("limit"), 50, 1, 100),
    });
    return jsonData(result, requestId);
  });
}

export async function POST(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requirePermission("catalog.write");
    const input = await readJson(request, productCreateCompleteSchema);
    const result = await withIdempotency({ request, scope: "admin.product.create", subject: actor.userId, payload: input, action: () => createProduct(input, actor, requestId) });
    return jsonData(result, requestId, { status: 201 });
  });
}
