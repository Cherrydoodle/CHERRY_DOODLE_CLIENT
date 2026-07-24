import { resourceIdSchema } from "@/features/admin/schemas";
import { getCustomer } from "@/features/admin-operations/service";
import { requirePermission } from "@/lib/auth/authorization";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleRoute(request, async ({ requestId }) => {
    await requirePermission("customers.read");
    const { id } = await context.params;
    return jsonData(await getCustomer(resourceIdSchema.parse(id)), requestId);
  });
}
