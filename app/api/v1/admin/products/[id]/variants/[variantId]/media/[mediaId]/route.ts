import { attachVariantMediaSchema, resourceIdSchema } from "@/features/admin/schemas";
import { attachVariantMedia, detachVariantMedia } from "@/features/admin/service";
import { requirePermission } from "@/lib/auth/authorization";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

type RouteContext = { params: Promise<{ id: string; variantId: string; mediaId: string }> };

export async function PUT(request: Request, context: RouteContext) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requirePermission("media.write");
    const { id, variantId, mediaId } = await context.params;
    const result = await attachVariantMedia(resourceIdSchema.parse(id), resourceIdSchema.parse(variantId), resourceIdSchema.parse(mediaId), await readJson(request, attachVariantMediaSchema), actor, requestId);
    return jsonData(result, requestId);
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requirePermission("media.write");
    const { id, variantId, mediaId } = await context.params;
    await detachVariantMedia(resourceIdSchema.parse(id), resourceIdSchema.parse(variantId), resourceIdSchema.parse(mediaId), actor, requestId);
    return new Response(null, { status: 204 });
  });
}
