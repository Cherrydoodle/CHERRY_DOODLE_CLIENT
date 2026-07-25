import { dispatchEmailOutbox } from "@/features/email/service";
import { assertCronRequest } from "@/lib/http/cron";
import { handleRoute, jsonData } from "@/lib/http/route";
import { withCronMonitor } from "@/lib/observability/cron-monitor";

export async function POST(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    assertCronRequest(request);
    return jsonData(await withCronMonitor("email-dispatch", dispatchEmailOutbox), requestId);
  });
}

// Vercel Cron invokes scheduled paths with GET; other schedulers typically POST.
export const GET = POST;
