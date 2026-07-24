import { sortOptions, type SortOption } from "@/lib/category-filters";

export type AllProductsFilters = {
  category?: string;
  sort: SortOption;
  sale: boolean;
  color?: string;
  priceMaxCents?: number;
  isNew: boolean;
  bestseller: boolean;
};

export { sortOptions };
export type { SortOption };

/** Serialize all-products filters into the query string shared by the server page and the client infinite-scroll fetch. */
export function allProductsFilterParams(filters: AllProductsFilters, limit: number): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.category) params.set("category", filters.category);
  if (filters.sort !== "featured") params.set("sort", filters.sort);
  if (filters.sale) params.set("sale", "true");
  if (filters.isNew) params.set("new", "true");
  if (filters.bestseller) params.set("bestseller", "true");
  if (filters.color) params.set("color", filters.color);
  if (filters.priceMaxCents !== undefined) params.set("priceMaxCents", String(filters.priceMaxCents));
  params.set("limit", String(limit));
  return params;
}
