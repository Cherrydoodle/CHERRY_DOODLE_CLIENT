import { attachMediaSchema, resourceIdSchema } from "@/features/admin/schemas";
import { attachProductMedia, detachProductMedia } from "@/features/admin/service";
import { requirePermission } from "@/lib/auth/authorization";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

type RouteContext = { params: Promise<{ id: string; mediaId: string }> };

export async function PUT(request: Request, context: RouteContext) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requirePermission("media.write");
    const { id, mediaId } = await context.params;
    const result = await attachProductMedia(resourceIdSchema.parse(id), resourceIdSchema.parse(mediaId), await readJson(request, attachMediaSchema), actor, requestId);
    return jsonData(result, requestId);
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requirePermission("media.write");
    const { id, mediaId } = await context.params;
    await detachProductMedia(resourceIdSchema.parse(id), resourceIdSchema.parse(mediaId), actor, requestId);
    return new Response(null, { status: 204 });
  });
}
