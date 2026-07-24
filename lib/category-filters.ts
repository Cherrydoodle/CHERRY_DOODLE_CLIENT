export const sortOptions = ["featured", "newest", "price-asc", "price-desc"] as const;

export type SortOption = (typeof sortOptions)[number];

export type CategoryFilters = {
  sub?: string;
  sort: SortOption;
  sale: boolean;
  color?: string;
  priceMaxCents?: number;
  isNew: boolean;
  bestseller: boolean;
};

/** Serialize category filters into the query string shared by the server page and the client infinite-scroll fetch. */
export function categoryFilterParams(categorySlug: string, filters: CategoryFilters, limit: number): URLSearchParams {
  const params = new URLSearchParams();
  params.set("category", categorySlug);
  if (filters.sub) params.set("sub", filters.sub);
  if (filters.sort !== "featured") params.set("sort", filters.sort);
  if (filters.sale) params.set("sale", "true");
  if (filters.isNew) params.set("new", "true");
  if (filters.bestseller) params.set("bestseller", "true");
  if (filters.color) params.set("color", filters.color);
  if (filters.priceMaxCents !== undefined) params.set("priceMaxCents", String(filters.priceMaxCents));
  params.set("limit", String(limit));
  return params;
}
