import type { ProductSummaryDTO } from "@/features/catalog/types";

export type ProductPage = { items: ProductSummaryDTO[]; nextCursor: string | null; total: number };

/**
 * Client-side fetch of one page of product cards from a list endpoint
 * (`/api/v1/products` or `/api/v1/search`). Reads the `{ data, meta }` envelope
 * produced by `jsonList` and surfaces the signed `nextCursor` for infinite scroll.
 */
export async function fetchProductPage(endpoint: string, params: URLSearchParams, signal?: AbortSignal): Promise<ProductPage> {
  const response = await fetch(`${endpoint}?${params.toString()}`, { headers: { accept: "application/json" }, signal });
  if (!response.ok) throw new Error("Products could not be loaded.");
  const body = (await response.json()) as { data?: ProductSummaryDTO[]; meta?: { total?: number; nextCursor?: string | null } };
  return { items: body.data ?? [], nextCursor: body.meta?.nextCursor ?? null, total: body.meta?.total ?? 0 };
}
