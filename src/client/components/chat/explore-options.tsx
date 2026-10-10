"use client";
import { GitFork } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useNow } from "@client/hooks/use-now";
import type { MessageState } from "@client/store/chat-store";
import { forkChat } from "@client/store/forks";
import { useChatStore } from "@client/store/hooks";
import { useSidebarChats } from "@client/store/sidebar-store";
import { CACHE_WARM_MS, MAX_FORKS, OPTIONS_CLICK_WAIT_MS, type ForkOption } from "@shared/forks";
import { lazyChunk } from "../ui/lazy-chunk";
import { useModals } from "../ui/modal-manager";

const ForkSheet = lazyChunk(() => dynamic(() => import("./fork-sheet").then((m) => m.ForkSheet), { ssr: false }));

/** waiting: no count yet; ready: clickable; awaiting: clicked before the options finished; busy: forking. */
export type ExploreState = "waiting" | "ready" | "awaiting" | "busy";

export interface ExploreOptionsProps {
  count: number | null;
  remaining: number;
  /** When the reply's request started, on this client's clock where known. */
  requestedAt: number;
  now: number;
  state: ExploreState;
  onOpen: () => void;
}

/** Opens the sheet, where the options are picked and forked; dull and pulsing until the count arrives. */
export function ExploreOptions({ count, remaining, requestedAt, now, state, onOpen }: ExploreOptionsProps) {
  const gradient = useId();
  const shown = count === null ? null : Math.min(count, remaining);
  const waiting = state === "waiting";
  const expired = !waiting && now > 0 && now - requestedAt > CACHE_WARM_MS;
  const label = state === "busy" ? "Forking…" : shown === null ? "Explore options" : `Explore ${shown} option${shown === 1 ? "" : "s"}`;
  return (
    <div className="mb-2 flex items-center gap-1">
      <button
        type="button"
        data-testid="explore-options"
        data-state={state}
        disabled={waiting || state === "busy"}
        aria-busy={state !== "ready"}
        aria-haspopup="dialog"
        className={cn(
          "relative isolate flex h-9 items-center gap-1.5 overflow-hidden rounded-lg px-3 text-small font-medium text-foreground outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50",
          waiting && "animate-pulse opacity-50",
          state === "awaiting" && "animate-pulse",
          state === "busy" && "opacity-60",
          expired && "tip",
        )}
        data-tip={expired ? "Cache expired: the first fork re-sends the whole chat" : undefined}
        data-tip-side="top"
        onClick={() => {
          if (state === "ready") onOpen();
        }}
      >
        <svg aria-hidden className="pointer-events-none absolute inset-0 -z-10 size-full">
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="var(--primary)" />
              <stop offset="0.5" stopColor="var(--chart-2)" />
              <stop offset="1" stopColor="var(--chart-3)" />
            </linearGradient>
          </defs>
          <rect x="1" y="1" rx="7" className="explore-border" style={{ width: "calc(100% - 2px)", height: "calc(100% - 2px)" }} fill="none" stroke={`url(#${gradient})`} strokeWidth="1.5" strokeDasharray="6 4" />
        </svg>
        <GitFork className="size-4" />
        {label}
      </button>
    </div>
  );
}

/** The composer's slot: wires the button to the options stream, the router, the sidebar's fork count and the sheet. */
export function ExploreOptionsIsland({ chatId, message }: { chatId: string; message: MessageState }) {
  const store = useChatStore();
  const router = useRouter();
  const { show } = useModals();
  const forks = useSidebarChats().filter((c) => c.forkedFrom === chatId).length;
  const now = useNow(10_000);
  const [busy, setBusy] = useState(false);
  const [awaiting, setAwaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const waitRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const wait = waitRef;
    return () => wait.current?.();
  }, []);
  const remaining = MAX_FORKS - forks;
  const stream = message.optionsStream;
  const count = stream ? stream.count : (message.options?.length ?? 0);
  const fork = useCallback(
    async (chosen: readonly ForkOption[]) => {
      setBusy(true);
      setError(null);
      const out = await forkChat(store, router, chatId, message.id, chosen);
      setBusy(false);
      if (out.error) setError(out.error);
      return out;
    },
    [store, router, chatId, message.id],
  );
  const openWith = useCallback(
    (options: readonly ForkOption[]) =>
      show(({ open, close }) => <ForkSheet open={open} onOpenChange={(o) => !o && close()} messageId={message.id} options={options} remaining={remaining} onFork={fork} />),
    [show, message.id, remaining, fork],
  );
  // Whatever has arrived: the final list, else the options complete so far; none means an error instead of the sheet.
  const openCurrent = useCallback(() => {
    const m = store.getMessage(message.id);
    const options = m?.optionsStream ? m.optionsStream.partial : (m?.options ?? []);
    if (options.length > 0) openWith(options);
    else setError("Couldn't load the options. Try again in a moment.");
  }, [store, message.id, openWith]);
  // A click before the options finish waits for them (at most OPTIONS_CLICK_WAIT_MS), then opens.
  const onOpen = useCallback(() => {
    const m = store.getMessage(message.id);
    if (!m?.optionsStream || m.optionsStream.failed) {
      openCurrent();
      return;
    }
    if (waitRef.current) return;
    setError(null);
    setAwaiting(true);
    const finish = () => {
      stop();
      setAwaiting(false);
      openCurrent();
    };
    const unsubscribe = store.subscribeMessage(message.id, () => {
      const s = store.getMessage(message.id)?.optionsStream;
      if (!s || s.failed) finish();
    });
    const timer = setTimeout(finish, OPTIONS_CLICK_WAIT_MS);
    const stop = () => {
      unsubscribe();
      clearTimeout(timer);
      waitRef.current = null;
    };
    waitRef.current = stop;
  }, [store, message.id, openCurrent]);
  if (remaining <= 0 || (count !== null && count < 2)) return null;
  const state: ExploreState = busy ? "busy" : awaiting ? "awaiting" : count === null ? "waiting" : "ready";
  return (
    <>
      <ExploreOptions count={count} remaining={remaining} requestedAt={message.timings?.client?.sent ?? message.createdAt} now={now} state={state} onOpen={onOpen} />
      {error ? (
        <p role="alert" className="mb-2 text-caption text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
}
