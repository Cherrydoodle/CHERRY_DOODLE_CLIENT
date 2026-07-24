import { getReconciliationReport } from "@/features/admin-reconciliation/service";
import { requirePermission } from "@/lib/auth/authorization";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function GET(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    await requirePermission("orders.read");
    return jsonData(await getReconciliationReport(), requestId);
  });
}
