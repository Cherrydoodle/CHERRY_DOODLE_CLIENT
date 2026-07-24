import { resourceIdSchema, roleUpdateSchema } from "@/features/admin/schemas";
import { updateUserRole } from "@/features/admin/service";
import { requirePermission } from "@/lib/auth/authorization";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function PATCH(request: Request, context: { params: Promise<{ userId: string }> }) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requirePermission("users.manage_roles");
    const { userId } = await context.params;
    return jsonData(await updateUserRole(resourceIdSchema.parse(userId), await readJson(request, roleUpdateSchema), actor, requestId), requestId);
  });
}
