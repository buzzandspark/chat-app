"use client";
import { Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { markNavigationClose } from "@client/hooks/use-back-gesture";
import { readJson, type SearchHit, type SearchResponse } from "@shared/api";
import { revealSearchHit } from "@client/store/search-reveal";
import { ResponsiveDialog } from "@client/components/ui/responsive-dialog";

/** ⌘/Ctrl+K: a sheet on phones, a modal at `md`, keyboard-safe. */
export function SearchDialog({
  open,
  onOpenChange,
  returnFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where focus goes on close (on a phone; see ResponsiveDialog). */
  returnFocus?: RefObject<HTMLElement | null>;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  // Keyboard: ↑/↓ move the active hit, Enter opens it.
  const [cursor, setCursor] = useState(0);

  const active = open && query.trim().length >= 2;
  // Debounced from the input: each keystroke drops the search before it (its timer, or its request) and
  // schedules its own 200 ms later.
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; controller: AbortController } | null>(null);
  const cancel = () => {
    if (!pending.current) return;
    clearTimeout(pending.current.timer);
    pending.current.controller.abort();
    pending.current = null;
  };
  // Closing drops a search still waiting on its timer or its request.
  const changeOpen = (next: boolean) => {
    if (!next) cancel();
    onOpenChange(next);
  };
  const search = (text: string) => {
    cancel();
    const q = text.trim();
    if (q.length < 2) {
      setSearching(false);
      return;
    }
    // Searching from the keystroke on, through the debounce, until this query's results are in.
    setSearching(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/chats/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        setHits(res.ok ? (await readJson<SearchResponse>(res)).hits : []);
      } catch {
        // aborted or offline
      } finally {
        if (pending.current?.controller === controller) setSearching(false);
      }
    }, 200);
    pending.current = { timer, controller };
  };
  const visibleHits = active && !searching ? hits : [];
  const activeIndex = visibleHits.length === 0 ? -1 : Math.min(cursor, visibleHits.length - 1);
  const opened = (hit: SearchHit) => {
    if (hit.messageId) revealSearchHit({ chatId: hit.chatId, messageId: hit.messageId, query: query.trim() });
    markNavigationClose();
    changeOpen(false);
  };
  const pick = (hit: SearchHit) => {
    opened(hit);
    router.push(`/c/${hit.chatId}`);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(visibleHits.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      pick(visibleHits[activeIndex]!);
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={changeOpen} title="Search chats" className="md:max-w-lg" returnFocus={returnFocus}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
            search(e.target.value);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search titles and messages"
          aria-label="Search chats"
          aria-autocomplete="list"
          aria-controls="search-hits"
          aria-activedescendant={activeIndex >= 0 ? `search-hit-${activeIndex}` : undefined}
          className="h-11 pl-9 text-body"
        />
      </div>
      <ul id="search-hits" role="listbox" className="mt-2 max-h-[50dvh] overflow-y-auto" aria-busy={searching}>
        {active && searching
          ? // Skeleton rows until this query's results are in: no stale hits from the previous query meanwhile.
            [0, 1, 2].map((i) => (
              <li key={i} className="flex min-h-11 flex-col justify-center gap-1.5 px-3 py-2" aria-hidden>
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-3/4" />
              </li>
            ))
          : null}
        {visibleHits.map((h, i) => (
          <li key={h.chatId} id={`search-hit-${i}`} role="option" aria-selected={i === activeIndex}>
            <Link
              href={`/c/${h.chatId}`}
              onClick={() => opened(h)}
              className={`flex min-h-11 flex-col justify-center rounded-lg px-3 py-2 hover:bg-muted active:bg-muted${i === activeIndex ? " bg-muted" : ""}`}
            >
              <span className="truncate text-body font-medium">{h.title}</span>
              {h.snippet ? <span className="truncate text-caption text-muted-foreground">{h.snippet}</span> : null}
            </Link>
          </li>
        ))}
        {open && query.trim().length === 1 ? <li className="px-3 py-3 text-small text-muted-foreground">Type at least 2 characters.</li> : null}
        {active && !searching && visibleHits.length === 0 ? (
          <li className="px-3 py-3 text-small text-muted-foreground">No matches.</li>
        ) : null}
      </ul>
    </ResponsiveDialog>
  );
}
