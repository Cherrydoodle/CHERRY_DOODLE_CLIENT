"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ProductCard } from "@/components/ProductCard";
import { ProductCardSkeleton } from "@/components/ProductCardSkeleton";
import type { ProductSummaryDTO } from "@/features/catalog/types";
import { fetchProductPage } from "@/lib/product-fetch";

const GRID_CLASS = "grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6";

/**
 * Renders an initial page of products (server-rendered) and appends further pages
 * as the user scrolls, using the signed `nextCursor` cursor pagination. An always-
 * present "Load more" button is both the accessibility path and the fallback when
 * IntersectionObserver is unavailable or does not fire.
 *
 * `query` is the serialized filter query (everything except `cursor`). Callers must
 * remount this component when `query` changes (e.g. `key={query}`) so the initial
 * page and cursor reset to the new server-rendered results.
 */
export function InfiniteProductGrid({
  endpoint,
  query,
  initialItems,
  initialCursor,
}: {
  endpoint: string;
  query: string;
  initialItems: ProductSummaryDTO[];
  initialCursor: string | null;
}) {
  const [items, setItems] = useState<ProductSummaryDTO[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadMore = useCallback(async () => {
    if (loading || !cursor) return;
    setLoading(true);
    try {
      const params = new URLSearchParams(query);
      params.set("cursor", cursor);
      const page = await fetchProductPage(endpoint, params);
      setItems((prev) => {
        const seen = new Set(prev.map((product) => product.id));
        return [...prev, ...page.items.filter((product) => !seen.has(product.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      toast.error("Could not load more products. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [loading, cursor, endpoint, query]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !cursor) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [cursor, loadMore]);

  return (
    <>
      <div className={GRID_CLASS}>
        {items.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
        {loading && Array.from({ length: 4 }).map((_, index) => <ProductCardSkeleton key={`loading-${index}`} />)}
      </div>
      {cursor && (
        <div ref={sentinelRef} className="mt-10 flex justify-center">
          <button type="button" onClick={loadMore} disabled={loading} className="btn-ghost-pink text-sm disabled:opacity-60">
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </>
  );
}
