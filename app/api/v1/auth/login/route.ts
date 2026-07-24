import { loginSchema, safeNextPath } from "@/features/auth/schemas";
import { login } from "@/features/auth/service";
import { clientIp } from "@/lib/http/client-ip";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function POST(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const input = await readJson(request, loginSchema);
    await enforceRateLimit({ scope: "login", subject: `${clientIp(request)}:${input.email}`, limit: 5, windowSeconds: 900 });
    return jsonData({ profile: await login(input), next: safeNextPath(input.next) }, requestId);
  });
}
