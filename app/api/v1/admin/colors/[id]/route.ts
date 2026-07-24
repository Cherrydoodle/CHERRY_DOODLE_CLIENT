import { resourceIdSchema } from "@/features/admin/schemas";
import { colorUpdateSchema } from "@/features/admin-operations/schemas";
import { deleteColor, updateColor } from "@/features/admin-operations/service";
import { requirePermission } from "@/lib/auth/authorization";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requirePermission("catalog.write");
    const { id } = await context.params;
    return jsonData(await updateColor(resourceIdSchema.parse(id), await readJson(request, colorUpdateSchema), actor, requestId), requestId);
  });
}

export async function DELETE(request: Request, context: Context) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requirePermission("catalog.write");
    const { id } = await context.params;
    await deleteColor(resourceIdSchema.parse(id), actor, requestId);
    return new Response(null, { status: 204 });
  });
}
