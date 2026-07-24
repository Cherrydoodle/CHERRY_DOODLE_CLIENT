import { resourceIdSchema, versionCommandSchema } from "@/features/admin/schemas";
import { reelUpdateSchema } from "@/features/admin-operations/schemas";
import { deleteReel, getReel, updateReel } from "@/features/admin-operations/reels";
import { requirePermission } from "@/lib/auth/authorization";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return handleRoute(request, async ({ requestId }) => {
    await requirePermission("content.write");
    const { id } = await context.params;
    return jsonData(await getReel(resourceIdSchema.parse(id)), requestId);
  });
}

export async function PATCH(request: Request, context: Context) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requirePermission("content.write");
    const { id } = await context.params;
    return jsonData(await updateReel(resourceIdSchema.parse(id), await readJson(request, reelUpdateSchema), actor, requestId), requestId);
  });
}

export async function DELETE(request: Request, context: Context) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requirePermission("content.write");
    const { id } = await context.params;
    const { expectedVersion } = await readJson(request, versionCommandSchema);
    await deleteReel(resourceIdSchema.parse(id), expectedVersion, actor, requestId);
    return new Response(null, { status: 204 });
  });
}
