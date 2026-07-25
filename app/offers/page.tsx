import type { Metadata } from "next";

import { getCategoryFacets, listCategories, listProducts } from "@/features/catalog/repository";
import { listActiveOffers } from "@/features/offers/repository";
import { offersFilterParams, sortOptions, type OffersFilters, type SortOption } from "@/lib/offers-filters";

import { OffersView } from "./offers-view";

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
  title: "Offers",
  description: "Every active discount campaign and offer product at Cherry Doodle.",
  alternates: { canonical: "/offers" },
};

export default async function OffersPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const [rawSearch, categories] = await Promise.all([searchParams, listCategories()]);

  const requestedCategory = first(rawSearch.category);
  const filters: OffersFilters = {
    category: categories.some((item) => item.slug === requestedCategory) ? requestedCategory : undefined,
    sort: parseSort(first(rawSearch.sort)),
    color: first(rawSearch.color) || undefined,
    priceMaxCents: parsePriceMax(first(rawSearch.priceMaxCents)),
  };

  const [productList, facets, campaigns] = await Promise.all([
    listProducts({ offer: true, category: filters.category, color: filters.color, priceMaxCents: filters.priceMaxCents, sort: filters.sort, limit: PAGE_SIZE }),
    getCategoryFacets({ category: filters.category }),
    listActiveOffers(),
  ]);

  const query = offersFilterParams(filters, PAGE_SIZE).toString();

  return (
    <OffersView
      categories={categories}
      filters={filters}
      facets={facets}
      campaigns={campaigns}
      initialItems={productList.items}
      nextCursor={productList.nextCursor}
      total={productList.total}
      query={query}
    />
  );
}
