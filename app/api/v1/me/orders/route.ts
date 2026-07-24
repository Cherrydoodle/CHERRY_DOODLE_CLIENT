import { listMyOrders } from "@/features/customer-orders/service";
import { integerParam } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function GET(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    const url = new URL(request.url);
    const page = integerParam(url.searchParams.get("page"), 1, 1, 1000);
    const limit = integerParam(url.searchParams.get("limit"), 20, 1, 50);
    // jsonData (private, no-store) is required here: jsonList sets a *public,
    // shared-cache* header intended for catalog listings, which would risk one
    // customer's order history being served from cache to another customer.
    const result = await listMyOrders(page, limit);
    return jsonData(result, requestId);
  });
}
