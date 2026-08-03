import { getServiceability } from "@/features/delhivery/service";
import { normalizeIndianPin } from "@/features/delhivery/normalize";
import { clientIp } from "@/lib/http/client-ip";
import { ApiError } from "@/lib/http/problem";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function GET(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    await enforceRateLimit({ scope: "serviceability", subject: clientIp(request), limit: 60, windowSeconds: 60 });
    const raw = new URL(request.url).searchParams.get("pincode");
    const pincode = normalizeIndianPin(raw);
    if (!pincode) throw new ApiError(422, "VALIDATION_ERROR", "Provide a valid 6-digit Indian pincode.");
    const result = await getServiceability(pincode);
    if (result === null) throw new ApiError(502, "SHIPPING_PROVIDER_UNAVAILABLE", "Delhivery could not be reached. Please try again.");
    return jsonData({ serviceable: result.serviceable, prepaid: result.prepaid, city: result.city, state: result.state }, requestId);
  });
}
