import { getDashboard } from "@/features/admin-operations/service";
import { requirePermission } from "@/lib/auth/authorization";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function GET(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    await requirePermission("dashboard.read");
    return jsonData(await getDashboard(), requestId);
  });
}
