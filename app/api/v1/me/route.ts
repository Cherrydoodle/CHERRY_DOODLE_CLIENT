import { updateProfileSchema } from "@/features/auth/schemas";
import { deleteMyAccount, getProfile, updateProfile } from "@/features/auth/service";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function GET(request: Request) {
  return handleRoute(request, async ({ requestId }) => jsonData(await getProfile(), requestId));
}

export async function PATCH(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    return jsonData(await updateProfile(await readJson(request, updateProfileSchema)), requestId);
  });
}

export async function DELETE(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    return jsonData(await deleteMyAccount(), requestId);
  });
}
