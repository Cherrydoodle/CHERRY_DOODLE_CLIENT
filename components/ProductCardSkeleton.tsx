import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder matching the ProductCard footprint, for loading states and load-more rows. */
export function ProductCardSkeleton() {
  return (
    <div className="rounded-3xl border border-border bg-white p-3">
      <Skeleton className="aspect-square w-full rounded-2xl" />
      <Skeleton className="mt-3 h-4 w-3/4 rounded-full" />
      <Skeleton className="mt-2 h-4 w-1/2 rounded-full" />
      <Skeleton className="mt-3 h-5 w-1/3 rounded-full" />
    </div>
  );
}

/** A responsive grid of ProductCard skeletons for full-page loading fallbacks. */
export function ProductGridSkeleton({ count = 8, className }: { count?: number; className?: string }) {
  return (
    <div className={className ?? "grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6"}>
      {Array.from({ length: count }).map((_, index) => (
        <ProductCardSkeleton key={index} />
      ))}
    </div>
  );
}
