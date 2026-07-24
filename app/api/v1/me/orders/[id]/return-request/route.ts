import { resourceIdSchema } from "@/features/admin/schemas";
import { customerReturnRequestSchema } from "@/features/refunds/schemas";
import { requestMyOrderReturn } from "@/features/refunds/service";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const { id } = await context.params;
    const input = await readJson(request, customerReturnRequestSchema);
    return jsonData(await requestMyOrderReturn(resourceIdSchema.parse(id), input), requestId);
  });
}
