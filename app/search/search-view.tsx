"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search as SearchIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

import { InfiniteProductGrid } from "@/components/InfiniteProductGrid";
import type { ProductSort, ProductSummaryDTO } from "@/features/catalog/types";

const SEARCH_SORTS: ReadonlyArray<{ value: ProductSort; label: string }> = [
  { value: "relevance", label: "Relevance" },
  { value: "price-asc", label: "Price: Low to High" },
  { value: "price-desc", label: "Price: High to Low" },
];

export function SearchView({
  searchQuery, sort, initialItems, nextCursor, total, query,
}: {
  searchQuery: string;
  sort: ProductSort;
  initialItems: ProductSummaryDTO[];
  nextCursor: string | null;
  total: number;
  query: string;
}) {
  const router = useRouter();
  const [queryInput, setQueryInput] = useState(searchQuery);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    router.push(queryInput.trim() ? `/search?q=${encodeURIComponent(queryInput.trim())}` : "/search");
  };

  const changeSort = (nextSort: ProductSort) => {
    const params = new URLSearchParams({ q: searchQuery });
    if (nextSort !== "relevance") params.set("sort", nextSort);
    router.push(`/search?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-10">
      <form onSubmit={submit} role="search" className="max-w-2xl">
        <div className="flex items-center gap-2 bg-white rounded-full px-5 py-3 border border-border shadow-soft focus-within:border-primary">
          <SearchIcon className="h-5 w-5 text-muted-foreground" />
          <label htmlFor="product-search" className="sr-only">Search products</label>
          <input
            id="product-search"
            autoFocus
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
            placeholder="Search stickers, notebooks, pens…"
            className="flex-1 bg-transparent outline-none"
          />
          <button type="submit" className="btn-primary text-sm px-4 py-1.5">Search</button>
        </div>
      </form>

      {searchQuery ? (
        <>
          <div className="mt-8 flex items-center justify-between">
            <h1 className="font-display text-2xl sm:text-3xl font-black">
              Results for <span className="text-primary">&quot;{searchQuery}&quot;</span>
            </h1>
            {total > 0 && (
              <>
                <label htmlFor="search-sort" className="sr-only">Sort search results</label>
                <select
                  id="search-sort"
                  value={sort}
                  onChange={(event) => changeSort(event.target.value as ProductSort)}
                  className="bg-white border border-border rounded-full px-4 py-2 text-sm font-semibold outline-none focus:border-primary"
                >
                  {SEARCH_SORTS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </>
            )}
          </div>
          <p className="text-muted-foreground text-sm mt-1 mb-6">{total} product{total !== 1 ? "s" : ""} found</p>

          {total === 0 ? (
            <div className="text-center py-20 border border-dashed border-border rounded-3xl bg-blush/40">
              <div className="text-6xl">🔍</div>
              <div className="font-display text-2xl font-bold mt-4">No matches</div>
              <p className="text-muted-foreground mt-2 max-w-sm mx-auto">
                We couldn&apos;t find anything for &quot;{searchQuery}&quot;. Try a different word, or browse categories.
              </p>
              <Link href="/" className="btn-primary mt-6 inline-flex">Browse home</Link>
            </div>
          ) : (
            <InfiniteProductGrid key={query} endpoint="/api/v1/search" query={query} initialItems={initialItems} initialCursor={nextCursor} />
          )}
        </>
      ) : (
        <div className="mt-16 text-center">
          <div className="text-6xl">🌸</div>
          <p className="mt-4 text-muted-foreground">Type something above to start searching.</p>
        </div>
      )}
    </div>
  );
}
