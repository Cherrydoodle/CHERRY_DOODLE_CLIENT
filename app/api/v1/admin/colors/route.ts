import { colorCreateSchema } from "@/features/admin-operations/schemas";
import { createColor, listColors } from "@/features/admin-operations/service";
import { requirePermission } from "@/lib/auth/authorization";
import { withIdempotency } from "@/lib/http/idempotency";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function GET(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    await requirePermission("catalog.write");
    return jsonData(await listColors(), requestId);
  });
}

export async function POST(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requirePermission("catalog.write");
    const input = await readJson(request, colorCreateSchema);
    const result = await withIdempotency({ request, scope: "admin.color.create", subject: actor.userId, payload: input, action: () => createColor(input, actor, requestId) });
    return jsonData(result, requestId, { status: 201 });
  });
}
