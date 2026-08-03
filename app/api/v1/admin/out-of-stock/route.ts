import { z } from "zod";

import { listOutOfStockVariants } from "@/features/admin/service";
import { requirePermission } from "@/lib/auth/authorization";
import { integerParam } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function GET(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    await requirePermission("catalog.write");
    const search = new URL(request.url).searchParams;
    const query = search.get("q")?.trim();
    const result = await listOutOfStockVariants({
      query: query ? z.string().max(100).parse(query) : undefined,
      page: integerParam(search.get("page"), 1, 1, 100_000), limit: integerParam(search.get("limit"), 50, 1, 100),
    });
    return jsonData(result, requestId);
  });
}
