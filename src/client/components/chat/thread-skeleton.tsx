/**
 * Keeps the list's spacing and nothing else: a new chat's server HTML carries it until hydration shows the
 * empty state, so it must not pretend a conversation exists.
 */
export function ThreadSkeleton() {
  return (
    <div className="relative min-h-0 flex-1" data-testid="thread-skeleton" aria-busy="true">
      <div className="mx-auto flex w-full max-w-thread flex-col gap-5 safe-x py-4 md:py-6" />
    </div>
  );
}
