import { sortOptions, type SortOption } from "@/lib/category-filters";

export type OffersFilters = {
  category?: string;
  sort: SortOption;
  color?: string;
  priceMaxCents?: number;
};

export { sortOptions };
export type { SortOption };

/** Serialize offers-page filters into the query string shared by the server page and the client infinite-scroll fetch. Always scoped to offer:true. */
export function offersFilterParams(filters: OffersFilters, limit: number): URLSearchParams {
  const params = new URLSearchParams();
  params.set("offer", "true");
  if (filters.category) params.set("category", filters.category);
  if (filters.sort !== "featured") params.set("sort", filters.sort);
  if (filters.color) params.set("color", filters.color);
  if (filters.priceMaxCents !== undefined) params.set("priceMaxCents", String(filters.priceMaxCents));
  params.set("limit", String(limit));
  return params;
}
