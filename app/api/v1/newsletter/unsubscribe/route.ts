import { unsubscribeSchema } from "@/features/newsletter/schemas";
import { unsubscribeNewsletter } from "@/features/newsletter/service";
import { readJson } from "@/lib/http/request";
import { handleRoute } from "@/lib/http/route";

export async function POST(request: Request) {
  return handleRoute(request, async () => {
    const { token } = await readJson(request, unsubscribeSchema);
    await unsubscribeNewsletter(token);
    return new Response(null, { status: 204, headers: { "cache-control": "private, no-store" } });
  });
}
