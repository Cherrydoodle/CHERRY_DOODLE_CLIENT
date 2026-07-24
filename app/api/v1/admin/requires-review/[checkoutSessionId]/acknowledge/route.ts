import { resourceIdSchema } from "@/features/admin/schemas";
import { acknowledgeReviewSchema } from "@/features/admin-reconciliation/schemas";
import { acknowledgeRequiresReview } from "@/features/admin-reconciliation/service";
import { requirePermission } from "@/lib/auth/authorization";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

type Context = { params: Promise<{ checkoutSessionId: string }> };

export async function POST(request: Request, context: Context) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requirePermission("orders.write");
    const { checkoutSessionId } = await context.params;
    const input = await readJson(request, acknowledgeReviewSchema);
    return jsonData(await acknowledgeRequiresReview(resourceIdSchema.parse(checkoutSessionId), input, actor, requestId), requestId);
  });
}
