import { contactSchema } from "@/features/contact/schemas";
import { submitContactMessage } from "@/features/contact/service";
import { clientIp } from "@/lib/http/client-ip";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { withIdempotency } from "@/lib/http/idempotency";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function POST(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const input = await readJson(request, contactSchema);
    await enforceRateLimit({
      scope: "contact",
      subject: clientIp(request),
      limit: 5,
      windowSeconds: 3_600,
    });
    // Honeypot: silently accept bots without persisting.
    if (input.company) return jsonData({ accepted: true }, requestId, { status: 202 });
    const result = await withIdempotency({
      request,
      scope: "contact.submit",
      subject: input.email,
      payload: input,
      action: () =>
        submitContactMessage(
          input,
          request.headers.get("x-forwarded-for"),
          request.headers.get("user-agent"),
        ),
    });
    return jsonData(result, requestId, { status: 202 });
  });
}
