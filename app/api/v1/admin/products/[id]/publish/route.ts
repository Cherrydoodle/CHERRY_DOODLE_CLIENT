import { publishProductSchema, resourceIdSchema } from "@/features/admin/schemas";
import { publishProduct } from "@/features/admin/service";
import { requirePermission } from "@/lib/auth/authorization";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requirePermission("catalog.publish");
    const { id } = await context.params;
    const input = await readJson(request, publishProductSchema);
    return jsonData(await publishProduct(resourceIdSchema.parse(id), input.publish, input.expectedVersion, actor, requestId), requestId);
  });
}
