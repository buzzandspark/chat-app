// Search → the matched text: the dialog sets a target, the chat's message list consumes it once the row
// is in the DOM (loading the rest of a long chat first). Outside React, so nothing re-renders for it.
interface Target {
  chatId: string;
  messageId: string;
  query: string;
}

let target: Target | null = null;
const listeners = new Set<() => void>();

export function revealSearchHit(next: Target): void {
  target = next;
  for (const l of listeners) l();
}

export function onSearchHit(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function searchHitFor(chatId: string): Target | null {
  return target?.chatId === chatId ? target : null;
}

export function clearSearchHit(): void {
  target = null;
}
