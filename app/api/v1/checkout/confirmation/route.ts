import { checkoutConfirmationSchema } from "@/features/checkout/schemas";
import { getCheckoutConfirmation } from "@/features/checkout/service";
import { clientIp } from "@/lib/http/client-ip";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { handleRoute, jsonData } from "@/lib/http/route";
import { ApiError } from "@/lib/http/problem";

export async function GET(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    const subjectIp = clientIp(request);
    await enforceRateLimit({ scope: "checkout-confirmation", subject: subjectIp, limit: 30, windowSeconds: 600 });
    const url = new URL(request.url);
    const parsed = checkoutConfirmationSchema.safeParse({
      checkoutId: url.searchParams.get("checkoutId"),
      checkoutToken: url.searchParams.get("checkoutToken"),
    });
    if (!parsed.success) throw new ApiError(400, "BAD_REQUEST", "A valid checkoutId and checkoutToken are required.");
    return jsonData(await getCheckoutConfirmation(parsed.data), requestId);
  });
}
