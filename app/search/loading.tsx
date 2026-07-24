import { ProductGridSkeleton } from "@/components/ProductCardSkeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function SearchLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-10">
      <Skeleton className="h-12 w-full max-w-2xl rounded-full" />
      <Skeleton className="mt-8 h-8 w-72 rounded-2xl" />
      <Skeleton className="mt-2 h-4 w-40 rounded-full" />
      <div className="mt-6">
        <ProductGridSkeleton count={8} />
      </div>
    </div>
  );
}
