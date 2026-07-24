import type { Metadata } from "next";

import { getCategoryFacets, listCategories, listProducts } from "@/features/catalog/repository";
import { allProductsFilterParams, sortOptions, type AllProductsFilters, type SortOption } from "@/lib/all-products-filters";

import { AllProductsView } from "./all-products-view";

const PAGE_SIZE = 24;

type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseSort(value: string | undefined): SortOption {
  return sortOptions.includes(value as SortOption) ? (value as SortOption) : "featured";
}

function parsePriceMax(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

export const metadata: Metadata = {
  title: "All Products",
  description: "Browse every product in the Cherry Doodle stationery collection.",
  alternates: { canonical: "/collections/all" },
};

export default async function AllProductsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const [rawSearch, categories] = await Promise.all([searchParams, listCategories()]);

  const requestedCategory = first(rawSearch.category);
  const filters: AllProductsFilters = {
    category: categories.some((item) => item.slug === requestedCategory) ? requestedCategory : undefined,
    sort: parseSort(first(rawSearch.sort)),
    sale: first(rawSearch.sale) === "true",
    color: first(rawSearch.color) || undefined,
    priceMaxCents: parsePriceMax(first(rawSearch.priceMaxCents)),
    isNew: first(rawSearch.new) === "true",
    bestseller: first(rawSearch.bestseller) === "true",
  };

  const [productList, facets] = await Promise.all([
    listProducts({
      category: filters.category,
      sale: filters.sale || undefined,
      isNew: filters.isNew || undefined,
      bestseller: filters.bestseller || undefined,
      color: filters.color,
      priceMaxCents: filters.priceMaxCents,
      sort: filters.sort,
      limit: PAGE_SIZE,
    }),
    getCategoryFacets({ category: filters.category }),
  ]);

  const query = allProductsFilterParams(filters, PAGE_SIZE).toString();

  return (
    <AllProductsView
      categories={categories}
      filters={filters}
      facets={facets}
      initialItems={productList.items}
      nextCursor={productList.nextCursor}
      total={productList.total}
      query={query}
    />
  );
}
