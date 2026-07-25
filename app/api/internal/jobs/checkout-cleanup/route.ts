import { cleanupExpiredCheckouts } from "@/features/checkout/service";
import { assertCronRequest } from "@/lib/http/cron";
import { handleRoute, jsonData } from "@/lib/http/route";
import { withCronMonitor } from "@/lib/observability/cron-monitor";

export async function POST(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    assertCronRequest(request);
    return jsonData(await withCronMonitor("checkout-cleanup", cleanupExpiredCheckouts), requestId);
  });
}

// Vercel Cron invokes scheduled paths with GET; other schedulers typically POST.
// Both are accepted, and both are gated by the same CRON_SECRET check.
export const GET = POST;
