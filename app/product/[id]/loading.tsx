import { Skeleton } from "@/components/ui/skeleton";

export default function ProductLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-10">
      <Skeleton className="h-3 w-48 rounded-full" />
      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        <Skeleton className="aspect-square w-full rounded-3xl" />
        <div className="space-y-4">
          <Skeleton className="h-9 w-3/4 rounded-2xl" />
          <Skeleton className="h-5 w-1/3 rounded-full" />
          <Skeleton className="h-7 w-1/4 rounded-full" />
          <Skeleton className="h-24 w-full rounded-2xl" />
          <div className="flex gap-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <Skeleton className="h-10 w-10 rounded-full" />
            <Skeleton className="h-10 w-10 rounded-full" />
          </div>
          <Skeleton className="h-12 w-full rounded-full" />
        </div>
      </div>
    </div>
  );
}
