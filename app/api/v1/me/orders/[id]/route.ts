import { resourceIdSchema } from "@/features/admin/schemas";
import { getMyOrder } from "@/features/customer-orders/service";
import { handleRoute, jsonData } from "@/lib/http/route";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return handleRoute(request, async ({ requestId }) => {
    const { id } = await context.params;
    return jsonData(await getMyOrder(resourceIdSchema.parse(id)), requestId);
  });
}
