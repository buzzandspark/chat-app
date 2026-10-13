/**
 * Keeps the list's spacing and nothing else: a saved chat's server HTML carries it until the seed arrives,
 * so it must not pretend a conversation exists.
 */
export function ThreadSkeleton() {
  return (
    <div className="relative min-h-0 flex-1" data-testid="thread-skeleton" aria-busy="true">
      <div className="mx-auto flex w-full max-w-thread flex-col gap-5 safe-x py-4 md:py-6" />
    </div>
  );
}

export function NewChatPrompt() {
  return (
    <div className="flex flex-1 items-center justify-center py-16 text-center text-small text-muted-foreground">
      Ask anything. Replies keep streaming even if you switch apps.
    </div>
  );
}

/** A new chat's server HTML: MessageList's boxes around its empty state, so hydration paints the same picture. */
export function EmptyThread() {
  return (
    <div className="relative min-h-0 flex-1">
      <div className="h-full overflow-y-auto overscroll-contain scroll-pb-4 [scrollbar-gutter:stable]">
        <div className="mx-auto flex w-full max-w-thread flex-col gap-5 safe-x py-4 md:py-6">
          <NewChatPrompt />
          <div className="h-px" />
        </div>
      </div>
    </div>
  );
}
