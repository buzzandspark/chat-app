"use client";
import { GitFork } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";
import { useNow } from "@client/hooks/use-now";
import type { MessageState } from "@client/store/chat-store";
import { forkChat } from "@client/store/forks";
import { useChatStore } from "@client/store/hooks";
import { useSidebarChats } from "@client/store/sidebar-store";
import { AUTO_FORK_LIMIT, CACHE_WARM_MS, MAX_FORKS, type ForkOption } from "@shared/forks";
import { lazyChunk } from "../ui/lazy-chunk";
import { useModals } from "../ui/modal-manager";

export const HOLD_MS = 600;
/** A press released within this counts as a click; longer, but short of the hold, is abandoned. */
export const CLICK_MS = 250;

const ForkSheet = lazyChunk(() => dynamic(() => import("./fork-sheet").then((m) => m.ForkSheet), { ssr: false }));

export interface ExploreOptionsProps {
  options: readonly ForkOption[];
  remaining: number;
  /** When the reply's request started, on this client's clock where known. */
  requestedAt: number;
  now: number;
  busy?: boolean;
  onFork: (options: readonly ForkOption[]) => void;
  onCustomize: () => void;
}

/** A click forks every option (up to five); press and hold opens the sheet, as does Shift with a click or Enter. */
export function ExploreOptions({ options, remaining, requestedAt, now, busy = false, onFork, onCustomize }: ExploreOptionsProps) {
  const gradient = useId();
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const downAt = useRef(0);
  const count = Math.min(options.length, remaining);
  const expired = now > 0 && now - requestedAt > CACHE_WARM_MS;
  const activate = useCallback(() => {
    if (options.length > AUTO_FORK_LIMIT || options.length > remaining) onCustomize();
    else onFork(options);
  }, [options, remaining, onFork, onCustomize]);
  const cancelHold = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  }, []);
  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || busy) return;
    held.current = false;
    downAt.current = Date.now();
    setHolding(true);
    timer.current = setTimeout(() => {
      held.current = true;
      cancelHold();
      onCustomize();
    }, HOLD_MS);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const fired = held.current || timer.current === null;
    const quick = Date.now() - downAt.current <= CLICK_MS;
    cancelHold();
    if (fired || !quick || busy) return;
    if (e.shiftKey) onCustomize();
    else activate();
  };
  return (
    <div className="mb-2 flex items-center gap-1">
      <button
        type="button"
        data-testid="explore-options"
        disabled={busy}
        aria-busy={busy}
        className={cn(
          "relative isolate flex h-9 touch-none items-center gap-1.5 overflow-hidden rounded-lg px-3 text-small font-medium text-foreground outline-none select-none [-webkit-touch-callout:none] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60",
          expired && "tip",
        )}
        data-tip={expired ? "Cache expired: the first fork re-sends the whole chat" : undefined}
        data-tip-side="top"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={cancelHold}
        onPointerCancel={cancelHold}
        onContextMenu={(e) => e.preventDefault()}
        // Shift opens the sheet (the hold has no keyboard form); a keyboard press arrives as a click with no pointer sequence before it.
        onClick={(e) => {
          if (busy) return;
          if (e.shiftKey) onCustomize();
          else if (e.detail === 0) activate();
        }}
      >
        <span
          aria-hidden
          className={cn("absolute inset-y-0 left-0 -z-10 w-full origin-left bg-primary/15", holding ? "scale-x-100 transition-transform duration-[600ms] ease-linear" : "scale-x-0")}
        />
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
        {busy ? "Forking…" : `Explore ${count} option${count === 1 ? "" : "s"}`}
      </button>
    </div>
  );
}

/** The composer's slot: wires the button to the store, the router, the sidebar's fork count and the sheet. */
export function ExploreOptionsIsland({ chatId, message }: { chatId: string; message: MessageState }) {
  const store = useChatStore();
  const router = useRouter();
  const { show } = useModals();
  const forks = useSidebarChats().filter((c) => c.forkedFrom === chatId).length;
  const now = useNow(10_000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = useMemo(() => message.options ?? [], [message.options]);
  const remaining = MAX_FORKS - forks;
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
  const customize = useCallback(
    () => show(({ open, close }) => <ForkSheet open={open} onOpenChange={(o) => !o && close()} messageId={message.id} options={options} remaining={remaining} onFork={fork} />),
    [show, message.id, options, remaining, fork],
  );
  if (options.length === 0 || remaining <= 0) return null;
  return (
    <>
      <ExploreOptions
        options={options}
        remaining={remaining}
        requestedAt={message.timings?.client?.sent ?? message.createdAt}
        now={now}
        busy={busy}
        onFork={(o) => void fork(o)}
        onCustomize={customize}
      />
      {error ? (
        <p role="alert" className="mb-2 text-caption text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
}
