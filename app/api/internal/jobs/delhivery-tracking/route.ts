import { syncShipments } from "@/features/delhivery/service";
import { assertCronRequest } from "@/lib/http/cron";
import { handleRoute, jsonData } from "@/lib/http/route";
import { withCronMonitor } from "@/lib/observability/cron-monitor";

export async function POST(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    assertCronRequest(request);
    return jsonData(await withCronMonitor("delhivery-tracking", () => syncShipments(50, requestId)), requestId);
  });
}

// Vercel Cron invokes scheduled paths with GET; other schedulers typically POST.
export const GET = POST;
