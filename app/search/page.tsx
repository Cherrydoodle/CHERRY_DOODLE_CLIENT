import type { Metadata } from "next";

import { listProducts } from "@/features/catalog/repository";
import type { ProductSort } from "@/features/catalog/types";

import { SearchView } from "./search-view";

export const metadata: Metadata = {
  title: "Search",
  description: "Search the Cherry Doodle stationery collection.",
  robots: { index: false, follow: true },
};

const PAGE_SIZE = 24;
const searchSorts: ProductSort[] = ["relevance", "price-asc", "price-desc"];

type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseSearchSort(value: string | undefined): ProductSort {
  return searchSorts.includes(value as ProductSort) ? (value as ProductSort) : "relevance";
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const rawSearch = await searchParams;
  const searchQuery = first(rawSearch.q)?.trim().slice(0, 100) ?? "";
  const sort = parseSearchSort(first(rawSearch.sort));

  const result = searchQuery
    ? await listProducts({ q: searchQuery, sort, limit: PAGE_SIZE })
    : { items: [], total: 0, nextCursor: null };

  const params = new URLSearchParams();
  params.set("q", searchQuery);
  if (sort !== "relevance") params.set("sort", sort);
  params.set("limit", String(PAGE_SIZE));

  return (
    <SearchView
      key={`${searchQuery}:${sort}`}
      searchQuery={searchQuery}
      sort={sort}
      initialItems={result.items}
      nextCursor={result.nextCursor}
      total={result.total}
      query={params.toString()}
    />
  );
}
