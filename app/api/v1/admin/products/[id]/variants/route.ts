import { resourceIdSchema, variantCreateSchema } from "@/features/admin/schemas";
import { createVariant } from "@/features/admin/service";
import { requirePermission } from "@/lib/auth/authorization";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requirePermission("catalog.write");
    const { id } = await context.params;
    const result = await createVariant(resourceIdSchema.parse(id), await readJson(request, variantCreateSchema), actor, requestId);
    return jsonData(result, requestId, { status: 201 });
  });
}
