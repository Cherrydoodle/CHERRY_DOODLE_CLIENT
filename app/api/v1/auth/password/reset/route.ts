import { resetPasswordSchema } from "@/features/auth/schemas";
import { resetPassword } from "@/features/auth/service";
import { clientIp } from "@/lib/http/client-ip";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { handleRoute } from "@/lib/http/route";

export async function POST(request: Request) {
  return handleRoute(request, async () => {
    assertSameOrigin(request);
    await enforceRateLimit({ scope: "reset-password", subject: clientIp(request), limit: 5, windowSeconds: 3600 });
    const { password } = await readJson(request, resetPasswordSchema);
    await resetPassword(password);
    return new Response(null, { status: 204, headers: { "cache-control": "private, no-store" } });
  });
}
