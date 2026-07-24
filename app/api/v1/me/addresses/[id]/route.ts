import { resourceIdSchema, versionCommandSchema } from "@/features/admin/schemas";
import { addressUpdateSchema } from "@/features/addresses/schemas";
import { deleteMyAddress, updateMyAddress } from "@/features/addresses/service";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const { id } = await context.params;
    const input = await readJson(request, addressUpdateSchema);
    return jsonData(await updateMyAddress(resourceIdSchema.parse(id), input), requestId);
  });
}

export async function DELETE(request: Request, context: Context) {
  return handleRoute(request, async () => {
    assertSameOrigin(request);
    const { id } = await context.params;
    const { expectedVersion } = await readJson(request, versionCommandSchema);
    await deleteMyAddress(resourceIdSchema.parse(id), expectedVersion);
    return new Response(null, { status: 204 });
  });
}
