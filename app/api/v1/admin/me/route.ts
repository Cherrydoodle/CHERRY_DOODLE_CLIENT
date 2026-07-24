import { adminProfileUpdateSchema } from "@/features/admin-operations/schemas";
import { getAdminProfile, updateAdminProfile } from "@/features/admin-operations/service";
import { requireUser } from "@/lib/auth/authorization";
import { ApiError } from "@/lib/http/problem";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

async function requireStaff() {
  const actor = await requireUser();
  if (actor.role === "customer") throw new ApiError(403, "FORBIDDEN", "A staff account is required.");
  return actor;
}

export async function GET(request: Request) {
  return handleRoute(request, async ({ requestId }) => jsonData(await getAdminProfile(await requireStaff()), requestId));
}

export async function PATCH(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requireStaff();
    return jsonData(await updateAdminProfile(await readJson(request, adminProfileUpdateSchema), actor, requestId), requestId);
  });
}
