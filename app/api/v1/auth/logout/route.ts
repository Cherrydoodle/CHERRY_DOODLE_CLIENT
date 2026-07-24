import { logout } from "@/features/auth/service";
import { requireUser } from "@/lib/auth/authorization";
import { assertSameOrigin } from "@/lib/http/request";
import { handleRoute } from "@/lib/http/route";

export async function POST(request: Request) {
  return handleRoute(request, async () => {
    assertSameOrigin(request);
    await requireUser();
    await logout();
    return new Response(null, { status: 204, headers: { "cache-control": "private, no-store" } });
  });
}
