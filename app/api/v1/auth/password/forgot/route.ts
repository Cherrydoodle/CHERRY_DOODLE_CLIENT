import { forgotPasswordSchema } from "@/features/auth/schemas";
import { requestPasswordReset } from "@/features/auth/service";
import { clientIp } from "@/lib/http/client-ip";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function POST(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const { email } = await readJson(request, forgotPasswordSchema);
    await enforceRateLimit({ scope: "forgot-password", subject: `${clientIp(request)}:${email}`, limit: 3, windowSeconds: 3600 });
    const callback = new URL("/auth/callback?next=/auth/reset-password", request.url).toString();
    return jsonData(await requestPasswordReset(email, callback), requestId, { status: 202 });
  });
}
