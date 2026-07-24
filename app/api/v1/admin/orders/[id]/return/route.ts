import { resourceIdSchema } from "@/features/admin/schemas";
import { resolveReturnSchema } from "@/features/refunds/schemas";
import { resolveOrderReturn } from "@/features/refunds/service";
import { requirePermission } from "@/lib/auth/authorization";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requirePermission("orders.write");
    const { id } = await context.params;
    const input = await readJson(request, resolveReturnSchema);
    return jsonData(await resolveOrderReturn(resourceIdSchema.parse(id), input, actor, requestId), requestId);
  });
}
