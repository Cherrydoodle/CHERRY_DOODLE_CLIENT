import { addressSchema } from "@/features/addresses/schemas";
import { createMyAddress, listMyAddresses } from "@/features/addresses/service";
import { assertSameOrigin, readJson } from "@/lib/http/request";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function GET(request: Request) {
  return handleRoute(request, async ({ requestId }) => jsonData(await listMyAddresses(), requestId));
}

export async function POST(request: Request) {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const input = await readJson(request, addressSchema);
    return jsonData(await createMyAddress(input), requestId);
  });
}
