import { resourceIdSchema } from "@/features/admin/schemas";
import { retryRequiresReviewCompletion } from "@/features/admin-reconciliation/service";
import { requirePermission } from "@/lib/auth/authorization";
import { assertSameOrigin } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

type Context = { params: Promise<{ checkoutSessionId: string }> };

export async function POST(request: Request, context: Context) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requirePermission("orders.write");
    const { checkoutSessionId } = await context.params;
    return jsonData(await retryRequiresReviewCompletion(resourceIdSchema.parse(checkoutSessionId), actor, requestId), requestId);
  });
}
