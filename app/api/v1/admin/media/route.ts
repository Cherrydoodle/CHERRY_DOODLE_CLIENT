import { listMedia, startMediaUpload } from "@/features/media/service";
import { createUploadSchema, mediaPurposeSchema, mediaStatusSchema } from "@/features/media/schemas";
import { requirePermission } from "@/lib/auth/authorization";
import { withIdempotency } from "@/lib/http/idempotency";
import { integerParam } from "@/lib/http/request";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function GET(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    await requirePermission("media.write");
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const purpose = url.searchParams.get("purpose");
    return jsonData(await listMedia({
      status: status ? mediaStatusSchema.parse(status) : undefined,
      purpose: purpose ? mediaPurposeSchema.parse(purpose) : undefined,
      limit: integerParam(url.searchParams.get("limit"), 50, 1, 100),
    }), requestId);
  });
}

export async function POST(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requirePermission("media.write");
    const input = await readJson(request, createUploadSchema);
    const result = await withIdempotency({ request, scope: "admin.media.upload", subject: actor.userId, payload: input, action: () => startMediaUpload(input, actor) });
    return jsonData(result, requestId, { status: 201 });
  });
}
