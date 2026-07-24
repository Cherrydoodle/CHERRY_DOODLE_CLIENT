import { mediaIdSchema } from "@/features/media/schemas";
import { requestMediaDeletion } from "@/features/media/service";
import { requirePermission } from "@/lib/auth/authorization";
import { assertSameOrigin } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function DELETE(request: Request, context: { params: Promise<{ mediaId: string }> }) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requirePermission("media.write");
    const { mediaId } = await context.params;
    const result = await requestMediaDeletion(mediaIdSchema.parse(mediaId), actor);
    return jsonData(result, requestId, { status: result.status === "delete_pending" ? 202 : 200 });
  });
}
