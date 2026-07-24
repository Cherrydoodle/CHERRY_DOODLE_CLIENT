"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronRight, SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";

import { InfiniteProductGrid } from "@/components/InfiniteProductGrid";
import type { CategoryFacets } from "@/features/catalog/repository";
import type { CategoryDTO, ProductSummaryDTO } from "@/features/catalog/types";
import type { AllProductsFilters, SortOption } from "@/lib/all-products-filters";

export function AllProductsView({
  categories, filters, facets, initialItems, nextCursor, total, query,
}: {
  categories: CategoryDTO[];
  filters: AllProductsFilters;
  facets: CategoryFacets;
  initialItems: ProductSummaryDTO[];
  nextCursor: string | null;
  total: number;
  query: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);

  const ceiling = facets.maxPriceCents;

  // Local slider position, kept in sync with the URL-driven filter across navigations
  // without an extra render (React's documented set-state-during-render pattern).
  const [priceMax, setPriceMax] = useState(filters.priceMaxCents ?? ceiling);
  const [syncedKey, setSyncedKey] = useState(`${ceiling}:${filters.priceMaxCents ?? ""}`);
  const currentKey = `${ceiling}:${filters.priceMaxCents ?? ""}`;
  if (currentKey !== syncedKey) {
    setSyncedKey(currentKey);
    setPriceMax(filters.priceMaxCents ?? ceiling);
  }

  const activeCategory = categories.find((category) => category.slug === filters.category);

  // Every filter change is a server round-trip: the URL is the single source of truth,
  // so results (and the infinite-scroll cursor) stay correct across the full result set
  // rather than only the batch already loaded on the client.
  const navigate = (next: AllProductsFilters) => {
    const params = new URLSearchParams();
    if (next.category) params.set("category", next.category);
    if (next.sort !== "featured") params.set("sort", next.sort);
    if (next.sale) params.set("sale", "true");
    if (next.isNew) params.set("new", "true");
    if (next.bestseller) params.set("bestseller", "true");
    if (next.color) params.set("color", next.color);
    if (next.priceMaxCents !== undefined) params.set("priceMaxCents", String(next.priceMaxCents));
    const queryString = params.toString();
    router.push(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
  };

  const commitPrice = () => {
    navigate({ ...filters, priceMaxCents: priceMax >= ceiling ? undefined : priceMax });
  };

  const sidebar = (
    <aside className="space-y-6">
      <div>
        <h3 className="font-display font-bold mb-3">Category</h3>
        <ul className="space-y-1.5">
          <li>
            <button
              type="button"
              onClick={() => navigate({ ...filters, category: undefined })}
              className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition ${!activeCategory ? "bg-primary text-primary-foreground" : "hover:bg-blush"}`}
            >
              All products
            </button>
          </li>
          {categories.map((category) => (
            <li key={category.slug}>
              <button
                type="button"
                onClick={() => navigate({ ...filters, category: category.slug })}
                className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition ${activeCategory?.slug === category.slug ? "bg-primary text-primary-foreground" : "hover:bg-blush"}`}
              >
                {category.emoji} {category.name}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <div className="font-display font-bold mb-3">Price</div>
        <input
          type="range"
          min={0}
          max={ceiling}
          value={priceMax}
          onChange={(event) => setPriceMax(Number(event.target.value))}
          onPointerUp={commitPrice}
          onKeyUp={commitPrice}
          className="w-full accent-primary"
          aria-label="Maximum price"
          disabled={ceiling === 0}
        />
        <div className="text-sm text-muted-foreground mt-1">Up to ₹{(priceMax / 100).toLocaleString("en-IN")}</div>
      </div>

      <div>
        <div className="font-display font-bold mb-3">Color</div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => navigate({ ...filters, color: undefined })} className={`chip ${!filters.color ? "bg-primary text-white" : "bg-muted"}`}>All</button>
          {facets.colors.map((color) => (
            <button
              type="button"
              key={color.id}
              onClick={() => navigate({ ...filters, color: filters.color === color.slug ? undefined : color.slug })}
              className={`h-8 w-8 rounded-full border-2 ${filters.color === color.slug ? "border-primary" : "border-border"}`}
              style={{ background: color.hex }}
              title={color.name}
              aria-label={color.name}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="font-display font-bold mb-3">Highlights</div>
        <label className="flex items-center gap-2 text-sm py-1">
          <input type="checkbox" checked={filters.isNew} onChange={(event) => navigate({ ...filters, isNew: event.target.checked })} className="accent-primary" /> New arrivals
        </label>
        <label className="flex items-center gap-2 text-sm py-1">
          <input type="checkbox" checked={filters.bestseller} onChange={(event) => navigate({ ...filters, bestseller: event.target.checked })} className="accent-primary" /> Bestsellers
        </label>
        <label className="flex items-center gap-2 text-sm py-1">
          <input type="checkbox" checked={filters.sale} onChange={(event) => navigate({ ...filters, sale: event.target.checked })} className="accent-primary" /> On sale
        </label>
      </div>
    </aside>
  );

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-10">
      <nav className="flex items-center gap-1 text-xs text-muted-foreground mb-4" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-primary">Home</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground font-semibold">{activeCategory ? activeCategory.name : "All Products"}</span>
      </nav>

      <div className="mb-8">
        <h1 className="font-display text-4xl sm:text-5xl font-black">{activeCategory ? activeCategory.name : "All Products"}</h1>
        <p className="text-muted-foreground mt-2">
          {activeCategory ? `Browse our ${activeCategory.name.toLowerCase()} collection.` : "Every Cherry Doodle product, in one place."}
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[240px_1fr]">
        <div className="hidden lg:block">{sidebar}</div>

        <div>
          <div className="flex items-center justify-between gap-3 mb-5">
            <button
              type="button"
              onClick={() => setDrawer(true)}
              className="lg:hidden inline-flex items-center gap-2 bg-white border border-border rounded-full px-4 py-2 text-sm font-semibold"
            >
              <SlidersHorizontal className="h-4 w-4" /> Filters
            </button>
            <div className="text-sm text-muted-foreground">{total} products</div>
            <label htmlFor="all-products-sort" className="sr-only">Sort products</label>
            <select
              id="all-products-sort"
              value={filters.sort}
              onChange={(event) => navigate({ ...filters, sort: event.target.value as SortOption })}
              className="bg-white border border-border rounded-full px-4 py-2 text-sm font-semibold outline-none focus:border-primary"
            >
              <option value="featured">Featured</option>
              <option value="newest">Newest</option>
              <option value="price-asc">Price: Low to High</option>
              <option value="price-desc">Price: High to Low</option>
            </select>
          </div>

          {total === 0 ? (
            <EmptyState />
          ) : (
            <InfiniteProductGrid key={query} endpoint="/api/v1/products" query={query} initialItems={initialItems} initialCursor={nextCursor} />
          )}
        </div>
      </div>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Filters">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <div className="absolute right-0 top-0 h-full w-[85%] max-w-sm bg-background p-6 overflow-y-auto animate-slide-in-right">
            <div className="flex items-center justify-between mb-6">
              <div className="font-display text-xl font-bold">Filters</div>
              <button type="button" onClick={() => setDrawer(false)} className="h-9 w-9 grid place-items-center rounded-full hover:bg-blush" aria-label="Close filters">
                <X className="h-5 w-5" />
              </button>
            </div>
            {sidebar}
            <button type="button" onClick={() => setDrawer(false)} className="btn-primary w-full mt-6">Show {total} products</button>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-16 border border-dashed border-border rounded-3xl bg-blush/40">
      <div className="text-5xl">🌷</div>
      <div className="font-display text-xl font-bold mt-4">No products match your filters</div>
      <p className="text-muted-foreground mt-1 text-sm">Try broadening your price or clearing filters.</p>
    </div>
  );
}
