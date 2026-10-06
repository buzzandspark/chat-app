"use client";
import { Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { ResponsiveDialog } from "../ui/responsive-dialog";

interface Hit {
  chatId: string;
  title: string;
  snippet: string | null;
  updatedAt: number;
}

/** D19 search (⌘/Ctrl+K): a sheet on phones, a modal at `md`, keyboard-safe. */
export function SearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);

  const active = open && query.trim().length >= 2;
  useEffect(() => {
    if (!active) return;
    const q = query.trim();
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/chats/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (res.ok) setHits(((await res.json()) as { hits: Hit[] }).hits);
      } catch {
        // aborted or offline
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, active]);
  const visibleHits = active ? hits : [];

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Search chats" className="md:max-w-lg">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Titles and messages"
          aria-label="Search chats"
          className="h-11 pl-9 text-body"
        />
      </div>
      <ul className="mt-2 max-h-[50dvh] overflow-y-auto" aria-busy={searching}>
        {visibleHits.map((h) => (
          <li key={h.chatId}>
            <Link
              href={`/c/${h.chatId}`}
              onClick={() => onOpenChange(false)}
              className="flex min-h-11 flex-col justify-center rounded-lg px-3 py-2 hover:bg-muted active:bg-muted"
            >
              <span className="truncate text-body font-medium">{h.title}</span>
              {h.snippet ? <span className="truncate text-caption text-muted-foreground">{h.snippet}</span> : null}
            </Link>
          </li>
        ))}
        {active && !searching && visibleHits.length === 0 ? (
          <li className="px-3 py-3 text-small text-muted-foreground">No matches.</li>
        ) : null}
      </ul>
    </ResponsiveDialog>
  );
}
