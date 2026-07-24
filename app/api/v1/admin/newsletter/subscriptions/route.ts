import { z } from "zod";

import { listNewsletterSubscriptions } from "@/features/admin/service";
import { requirePermission } from "@/lib/auth/authorization";
import { integerParam } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

const subscriptionStatus = z.enum(["pending", "active", "unsubscribed", "suppressed"]);

export async function GET(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    await requirePermission("newsletter.read");
    const search = new URL(request.url).searchParams;
    const status = search.get("status");
    const result = await listNewsletterSubscriptions(integerParam(search.get("limit"), 50, 1, 100), status ? subscriptionStatus.parse(status) : undefined);
    return jsonData(result, requestId);
  });
}
