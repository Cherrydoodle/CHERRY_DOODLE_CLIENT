import { resourceIdSchema, versionCommandSchema } from "@/features/admin/schemas";
import { offerUpdateSchema } from "@/features/offers/schemas";
import { deleteOffer, getOffer, updateOffer } from "@/features/offers/service";
import { requirePermission } from "@/lib/auth/authorization";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return handleRoute(request, async ({ requestId }) => {
    await requirePermission("catalog.write");
    const { id } = await context.params;
    return jsonData(await getOffer(resourceIdSchema.parse(id)), requestId);
  });
}

export async function PATCH(request: Request, context: Context) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requirePermission("catalog.write");
    const { id } = await context.params;
    return jsonData(await updateOffer(resourceIdSchema.parse(id), await readJson(request, offerUpdateSchema), actor, requestId), requestId);
  });
}

export async function DELETE(request: Request, context: Context) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const actor = await requirePermission("catalog.write");
    const { id } = await context.params;
    const { expectedVersion } = await readJson(request, versionCommandSchema);
    await deleteOffer(resourceIdSchema.parse(id), expectedVersion, actor, requestId);
    return new Response(null, { status: 204 });
  });
}
