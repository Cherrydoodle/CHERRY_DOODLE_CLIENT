import { reelCreateSchema } from "@/features/admin-operations/schemas";
import { createReel, listReels } from "@/features/admin-operations/reels";
import { requirePermission } from "@/lib/auth/authorization";
import { withIdempotency } from "@/lib/http/idempotency";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function GET(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    await requirePermission("content.write");
    return jsonData(await listReels(), requestId);
  });
}

export async function POST(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requirePermission("content.write");
    const input = await readJson(request, reelCreateSchema);
    const result = await withIdempotency({ request, scope: "admin.reel.create", subject: actor.userId, payload: input, action: () => createReel(input, actor, requestId) });
    return jsonData(result, requestId, { status: 201 });
  });
}
