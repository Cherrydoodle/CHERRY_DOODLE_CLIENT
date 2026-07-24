import { resourceIdSchema } from "@/features/admin/schemas";
import { orderUpdateSchema } from "@/features/admin-operations/schemas";
import { getOrder, updateOrder } from "@/features/admin-operations/service";
import { requirePermission } from "@/lib/auth/authorization";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return handleRoute(request, async ({ requestId }) => {
    await requirePermission("orders.read");
    const { id } = await context.params;
    return jsonData(await getOrder(resourceIdSchema.parse(id)), requestId);
  });
}

export async function PATCH(request: Request, context: Context) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requirePermission("orders.write");
    const { id } = await context.params;
    return jsonData(await updateOrder(resourceIdSchema.parse(id), await readJson(request, orderUpdateSchema), actor, requestId), requestId);
  });
}
