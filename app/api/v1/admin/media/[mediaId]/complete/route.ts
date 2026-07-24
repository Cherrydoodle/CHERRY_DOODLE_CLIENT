import { completeUploadSchema, mediaIdSchema } from "@/features/media/schemas";
import { completeMediaUpload } from "@/features/media/service";
import { requirePermission } from "@/lib/auth/authorization";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function POST(request: Request, context: { params: Promise<{ mediaId: string }> }) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    await requirePermission("media.write");
    const { mediaId } = await context.params;
    await readJson(request, completeUploadSchema);
    return jsonData(await completeMediaUpload(mediaIdSchema.parse(mediaId)), requestId);
  });
}
