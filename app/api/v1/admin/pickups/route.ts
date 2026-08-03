import { requestPickup } from "@/features/delhivery/service";
import { pickupRequestInputSchema } from "@/features/delhivery/schemas";
import { requirePermission } from "@/lib/auth/authorization";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function POST(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requirePermission("orders.write");
    const body = await readJson(request, pickupRequestInputSchema);
    const result = await requestPickup(body, actor, requestId);
    return jsonData(result, requestId, { status: 201 });
  });
}
