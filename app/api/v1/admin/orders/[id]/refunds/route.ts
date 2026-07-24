import { resourceIdSchema } from "@/features/admin/schemas";
import { issueRefundSchema } from "@/features/refunds/schemas";
import { issueRefund } from "@/features/refunds/service";
import { requirePermission } from "@/lib/auth/authorization";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { withIdempotency } from "@/lib/http/idempotency";
import { handleRoute, jsonData } from "@/lib/http/route";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requirePermission("orders.write");
    const { id } = await context.params;
    const orderId = resourceIdSchema.parse(id);
    const input = await readJson(request, issueRefundSchema);
    const result = await withIdempotency({
      request,
      scope: "admin.refund.issue",
      subject: orderId,
      payload: input,
      action: () => issueRefund(orderId, input, actor, requestId),
    });
    return jsonData(result, requestId);
  });
}
