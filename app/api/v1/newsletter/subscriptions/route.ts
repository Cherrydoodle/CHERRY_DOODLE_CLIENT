import { subscribeSchema } from "@/features/newsletter/schemas";
import { subscribeNewsletter } from "@/features/newsletter/service";
import { clientIp } from "@/lib/http/client-ip";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { withIdempotency } from "@/lib/http/idempotency";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function POST(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const input = await readJson(request, subscribeSchema);
    await enforceRateLimit({ scope: "newsletter", subject: clientIp(request), limit: 5, windowSeconds: 86_400 });
    if (input.company) return jsonData({ accepted: true }, requestId, { status: 202 });
    const result = await withIdempotency({
      request,
      scope: "newsletter.subscribe",
      subject: input.email,
      payload: input,
      action: () => subscribeNewsletter(input.email, input.source ?? "footer", new URL(request.url).origin, request.headers.get("x-forwarded-for")),
    });
    return jsonData(result, requestId, { status: 202 });
  });
}
