import { Skeleton } from "@/components/ui/skeleton";

/** D21: skeletons match the final layout so there is no shift when messages arrive. */
export function ThreadSkeleton() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-thread flex-1 space-y-6 px-gutter py-6">
        <div className="flex justify-end">
          <Skeleton className="h-11 w-2/3 rounded-bubble" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
      <div className="safe-bottom px-gutter pb-3">
        <Skeleton className="h-14 w-full rounded-xl" />
      </div>
    </div>
  );
}
