import { resourceIdSchema } from "@/features/admin/schemas";
import { markOrderReturned } from "@/features/refunds/service";
import { requirePermission } from "@/lib/auth/authorization";
import { assertSameOrigin } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requirePermission("orders.write");
    const { id } = await context.params;
    return jsonData(await markOrderReturned(resourceIdSchema.parse(id), actor, requestId), requestId);
  });
}
