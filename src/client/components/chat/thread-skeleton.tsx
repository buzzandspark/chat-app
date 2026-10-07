import { Skeleton } from "@/components/ui/skeleton";

/** D21: the thread placeholder uses the list's own spacing so rows land where the skeleton was. */
export function ThreadSkeleton() {
  return (
    <div className="relative min-h-0 flex-1" data-testid="thread-skeleton">
      <div className="mx-auto flex w-full max-w-thread flex-col gap-5 safe-x py-4 md:py-6">
        <div className="flex justify-end">
          <Skeleton className="h-11 w-2/3 rounded-bubble" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    </div>
  );
}
