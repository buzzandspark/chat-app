import { Skeleton } from "@/components/ui/skeleton";
import { ThreadSkeleton } from "./thread-skeleton";

// Rendered by the server page only (the route's Suspense fallback), so it stays out of the client chunk.

/**
 * Mirrors `Composer`'s boxes and paddings class for class, so the composer measures the same
 * (115 px on a phone) whether the real one or this placeholder is on screen.
 */
function ComposerSkeleton() {
  return (
    <div
      className="shrink-0 border-t border-border bg-background safe-x pt-2"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 0.5rem)" }}
      aria-hidden
      data-testid="composer-skeleton"
    >
      <div className="mx-auto w-full max-w-thread">
        <div className="flex flex-col rounded-xl border border-input bg-card shadow-xs">
          <div className="min-h-11 w-full px-3 py-2.5 text-body text-muted-foreground">Send a message</div>
          <div className="flex items-center justify-between gap-1 px-1.5 pb-1.5">
            <div className="flex min-w-0 items-center gap-0.5">
              <Skeleton className="touch-target w-24 rounded-lg" />
              <Skeleton className="touch-target rounded-lg" />
            </div>
            <Skeleton className="touch-target rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** The whole chat column while the route's dynamic part streams on a hard load. */
export function ChatViewSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ThreadSkeleton />
      <ComposerSkeleton />
    </div>
  );
}
