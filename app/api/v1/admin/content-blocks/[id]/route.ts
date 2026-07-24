import { contentUpdateSchema, resourceIdSchema, versionCommandSchema } from "@/features/admin/schemas";
import { deleteContentBlock, updateContentBlock } from "@/features/admin/service";
import { requirePermission } from "@/lib/auth/authorization";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requirePermission("content.write");
    const { id } = await context.params;
    return jsonData(await updateContentBlock(resourceIdSchema.parse(id), await readJson(request, contentUpdateSchema), actor, requestId), requestId);
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requirePermission("content.write");
    const { id } = await context.params;
    const { expectedVersion } = await readJson(request, versionCommandSchema);
    await deleteContentBlock(resourceIdSchema.parse(id), expectedVersion, actor, requestId);
    return new Response(null, { status: 204 });
  });
}
