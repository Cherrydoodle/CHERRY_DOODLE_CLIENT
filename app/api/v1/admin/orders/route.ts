import { z } from "zod";

import { orderStatusSchema } from "@/features/admin-operations/schemas";
import { listOrders } from "@/features/admin-operations/service";
import { requirePermission } from "@/lib/auth/authorization";
import { integerParam } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function GET(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    await requirePermission("orders.read");
    const params = new URL(request.url).searchParams;
    const rawStatus = params.get("status");
    const rawDate = params.get("date");
    const rawPaymentId = params.get("paymentId");
    const result = await listOrders({
      query: params.get("q") ? z.string().trim().min(1).max(100).parse(params.get("q")) : undefined,
      status: rawStatus ? orderStatusSchema.parse(rawStatus) : undefined,
      date: rawDate ? z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(rawDate) : undefined,
      paymentId: rawPaymentId ? z.string().regex(/^pay_[A-Za-z0-9]+$/).parse(rawPaymentId) : undefined,
      page: integerParam(params.get("page"), 1, 1, 100_000),
      limit: integerParam(params.get("limit"), 20, 1, 100),
    });
    return jsonData(result, requestId);
  });
}
