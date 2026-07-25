import { ProductGridSkeleton } from "@/components/ProductCardSkeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function OffersLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-10">
      <Skeleton className="h-3 w-40 rounded-full" />
      <Skeleton className="mt-6 h-10 w-64 rounded-2xl" />
      <Skeleton className="mt-3 h-4 w-80 rounded-full" />
      <div className="mt-6 flex gap-4 overflow-hidden">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-40 w-80 rounded-3xl shrink-0" />
        ))}
      </div>
      <div className="mt-8 grid gap-8 lg:grid-cols-[240px_1fr]">
        <div className="hidden space-y-4 lg:block">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-9 w-full rounded-xl" />
          ))}
        </div>
        <ProductGridSkeleton count={8} />
      </div>
    </div>
  );
}
