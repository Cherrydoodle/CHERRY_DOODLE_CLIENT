import { passwordChangeSchema } from "@/features/admin-operations/schemas";
import { changeAdminPassword } from "@/features/admin-operations/service";
import { requireUser } from "@/lib/auth/authorization";
import { ApiError } from "@/lib/http/problem";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function POST(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requireUser();
    if (actor.role === "customer") throw new ApiError(403, "FORBIDDEN", "A staff account is required.");
    const input = await readJson(request, passwordChangeSchema);
    return jsonData(await changeAdminPassword(input.currentPassword, input.newPassword, actor, requestId), requestId);
  });
}
