import { resourceIdSchema } from "@/features/admin/schemas";
import { createShipmentForOrder, getShipmentForOrder } from "@/features/delhivery/service";
import { shipmentCreateInputSchema } from "@/features/delhivery/schemas";
import { requirePermission } from "@/lib/auth/authorization";
import { ApiError } from "@/lib/http/problem";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { withIdempotency } from "@/lib/http/idempotency";
import { handleRoute, jsonData } from "@/lib/http/route";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return handleRoute(request, async ({ requestId }) => {
    await requirePermission("orders.read");
    const { id } = await context.params;
    const orderId = resourceIdSchema.parse(id);
    const shipment = await getShipmentForOrder(orderId);
    if (!shipment) throw new ApiError(404, "NOT_FOUND", "This order has no Delhivery shipment.");
    return jsonData(shipment, requestId);
  });
}

export async function POST(request: Request, context: Context) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requirePermission("orders.write");
    const { id } = await context.params;
    const orderId = resourceIdSchema.parse(id);
    const body = await readJson(request, shipmentCreateInputSchema);
    // A retried POST (network blip, double-click) must never manifest a second
    // waybill for the same order -- the idempotency key scopes the retry to the
    // exact same request body, matching the razorpay/order route's pattern.
    const shipment = await withIdempotency({
      request, scope: "delhivery-shipment-create", subject: orderId, payload: body,
      action: () => createShipmentForOrder(orderId, body, actor, requestId),
    });
    return jsonData(shipment, requestId, { status: 201 });
  });
}
