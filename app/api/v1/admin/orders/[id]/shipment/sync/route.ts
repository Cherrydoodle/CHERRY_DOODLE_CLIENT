import { resourceIdSchema } from "@/features/admin/schemas";
import { syncShipmentForOrder } from "@/features/delhivery/service";
import { requirePermission } from "@/lib/auth/authorization";
import { assertSameOrigin } from "@/lib/http/request";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { handleRoute, jsonData } from "@/lib/http/route";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requirePermission("orders.write");
    await enforceRateLimit({ scope: "delhivery-manual-sync", subject: actor.userId, limit: 20, windowSeconds: 60 });
    const { id } = await context.params;
    const shipment = await syncShipmentForOrder(resourceIdSchema.parse(id), requestId);
    return jsonData(shipment, requestId);
  });
}
