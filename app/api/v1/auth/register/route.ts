import { registerSchema } from "@/features/auth/schemas";
import { register } from "@/features/auth/service";
import { clientIp } from "@/lib/http/client-ip";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { withIdempotency } from "@/lib/http/idempotency";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function POST(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const input = await readJson(request, registerSchema);
    await enforceRateLimit({ scope: "register", subject: `${clientIp(request)}:${input.email}`, limit: 5, windowSeconds: 900 });
    const callback = new URL("/auth/callback?next=/account", request.url).toString();
    const result = await withIdempotency({ request, scope: "auth.register", subject: input.email, payload: input, action: () => register(input, callback) });
    const status = "verificationRequired" in result ? 202 : 200;
    return jsonData(result, requestId, { status });
  });
}
