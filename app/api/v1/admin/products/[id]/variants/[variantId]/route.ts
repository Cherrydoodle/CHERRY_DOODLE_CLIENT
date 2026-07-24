import { resourceIdSchema, variantUpdateSchema, versionCommandSchema } from "@/features/admin/schemas";
import { deleteVariant, updateVariant } from "@/features/admin/service";
import { requirePermission } from "@/lib/auth/authorization";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

type RouteContext = { params: Promise<{ id: string; variantId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requirePermission("catalog.write");
    const { id, variantId } = await context.params;
    const result = await updateVariant(resourceIdSchema.parse(id), resourceIdSchema.parse(variantId), await readJson(request, variantUpdateSchema), actor, requestId);
    return jsonData(result, requestId);
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requirePermission("catalog.write");
    const { id, variantId } = await context.params;
    const { expectedVersion } = await readJson(request, versionCommandSchema);
    await deleteVariant(resourceIdSchema.parse(id), resourceIdSchema.parse(variantId), expectedVersion, actor, requestId);
    return new Response(null, { status: 204 });
  });
}
