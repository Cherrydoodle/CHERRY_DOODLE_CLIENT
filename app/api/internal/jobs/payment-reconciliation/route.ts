import { runPaymentReconciliationSync } from "@/features/admin-reconciliation/service";
import { ApiError } from "@/lib/http/problem";
import { handleRoute, jsonData } from "@/lib/http/route";
import { withCronMonitor } from "@/lib/observability/cron-monitor";

export async function POST(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    const expected = process.env.CRON_SECRET;
    if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) throw new ApiError(401, "AUTH_REQUIRED", "Invalid job credentials.");
    return jsonData(await withCronMonitor("payment-reconciliation", runPaymentReconciliationSync), requestId);
  });
}
