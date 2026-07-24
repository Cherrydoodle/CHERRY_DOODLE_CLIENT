import { listAuditLogs } from "@/features/admin/service";
import { requirePermission } from "@/lib/auth/authorization";
import { integerParam } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function GET(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    await requirePermission("audit.read");
    const search = new URL(request.url).searchParams;
    return jsonData(await listAuditLogs(integerParam(search.get("limit"), 50, 1, 100)), requestId);
  });
}
