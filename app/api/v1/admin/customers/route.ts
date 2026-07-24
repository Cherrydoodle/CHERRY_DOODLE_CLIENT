import { z } from "zod";

import { listCustomers } from "@/features/admin-operations/service";
import { requirePermission } from "@/lib/auth/authorization";
import { integerParam } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function GET(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    await requirePermission("customers.read");
    const params = new URL(request.url).searchParams;
    const result = await listCustomers({
      query: params.get("q") ? z.string().trim().min(1).max(100).parse(params.get("q")) : undefined,
      page: integerParam(params.get("page"), 1, 1, 100_000),
      limit: integerParam(params.get("limit"), 20, 1, 100),
    });
    return jsonData(result, requestId);
  });
}
