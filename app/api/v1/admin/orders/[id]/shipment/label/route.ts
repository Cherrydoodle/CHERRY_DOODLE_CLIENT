import { resourceIdSchema } from "@/features/admin/schemas";
import { getShipmentLabel } from "@/features/delhivery/service";
import { requirePermission } from "@/lib/auth/authorization";
import { handleRoute } from "@/lib/http/route";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return handleRoute(request, async () => {
    await requirePermission("orders.read");
    const { id } = await context.params;
    const label = await getShipmentLabel(resourceIdSchema.parse(id));
    // Delhivery's token never reaches the browser -- this route fetches the label
    // server-side and streams back only the bytes and content-type it received.
    return new Response(label.bytes, { headers: { "content-type": label.contentType, "cache-control": "private, no-store" } });
  });
}
