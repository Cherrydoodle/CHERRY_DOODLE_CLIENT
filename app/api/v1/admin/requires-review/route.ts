import { listRequiresReviewQueue } from "@/features/admin-reconciliation/service";
import { requirePermission } from "@/lib/auth/authorization";
import { integerParam } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function GET(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    await requirePermission("orders.read");
    const params = new URL(request.url).searchParams;
    const result = await listRequiresReviewQueue(
      integerParam(params.get("page"), 1, 1, 100_000),
      integerParam(params.get("limit"), 20, 1, 100),
    );
    return jsonData(result, requestId);
  });
}
