import { listCategories } from "@/features/catalog/repository";
import { slugSchema } from "@/features/catalog/schemas";
import { ApiError } from "@/lib/http/problem";
import { handleRoute, jsonData } from "@/lib/http/route";

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  return handleRoute(request, async ({ requestId }) => {
    const { slug: rawSlug } = await context.params;
    const slug = slugSchema.parse(rawSlug);
    const category = (await listCategories()).find((item) => item.slug === slug);
    if (!category) throw new ApiError(404, "NOT_FOUND", "Category not found.");
    return jsonData({ category }, requestId, { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=1800" } });
  });
}
