import { storeSettingsUpdateSchema } from "@/features/admin-operations/schemas";
import { getStoreSettings, updateStoreSettings } from "@/features/admin-operations/service";
import { requirePermission } from "@/lib/auth/authorization";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function GET(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    await requirePermission("settings.read");
    return jsonData(await getStoreSettings(), requestId);
  });
}

export async function PATCH(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requirePermission("settings.write");
    return jsonData(await updateStoreSettings(await readJson(request, storeSettingsUpdateSchema), actor, requestId), requestId);
  });
}
