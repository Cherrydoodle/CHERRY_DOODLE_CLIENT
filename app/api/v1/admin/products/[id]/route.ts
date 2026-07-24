import { productUpdateSchema, resourceIdSchema, versionCommandSchema } from "@/features/admin/schemas";
import { deleteProduct, getAdminProduct, updateProduct } from "@/features/admin/service";
import { requirePermission } from "@/lib/auth/authorization";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  return handleRoute(request, async ({ requestId }) => {
    await requirePermission("catalog.write");
    const { id } = await context.params;
    return jsonData(await getAdminProduct(resourceIdSchema.parse(id)), requestId);
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requirePermission("catalog.write");
    const { id } = await context.params;
    const result = await updateProduct(resourceIdSchema.parse(id), await readJson(request, productUpdateSchema), actor, requestId);
    return jsonData(result, requestId);
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requirePermission("catalog.write");
    const { id } = await context.params;
    const { expectedVersion } = await readJson(request, versionCommandSchema);
    await deleteProduct(resourceIdSchema.parse(id), expectedVersion, actor, requestId);
    return new Response(null, { status: 204 });
  });
}
