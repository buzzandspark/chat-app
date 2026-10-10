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

/** waiting: looking for options; disabled: unavailable (the reason is the tooltip); ready: clickable; awaiting: clicked early; busy: forking. */
export type ExploreState = "waiting" | "disabled" | "ready" | "awaiting" | "busy";

export interface ExploreOptionsProps {
  count: number | null;
  remaining: number;
  /** When the reply's request started, on this client's clock where known. */
  requestedAt: number;
  now: number;
  state: ExploreState;
  reason?: string | null;
  onOpen: () => void;
}

/** Always shown above the composer; aria-disabled rather than disabled so hover and focus still show why. */
export function ExploreOptions({ count, remaining, requestedAt, now, state, reason = null, onOpen }: ExploreOptionsProps) {
  const gradient = useId();
  const inactive = state === "waiting" || state === "disabled" || state === "busy";
  const shown = count === null || state === "disabled" ? null : Math.min(count, remaining);
  const expired = state === "ready" && now > 0 && now - requestedAt > CACHE_WARM_MS;
  const tip = state === "waiting" ? "Looking for options…" : state === "disabled" ? reason : expired ? "Cache expired: the first fork re-sends the whole chat" : null;
  const label = state === "busy" ? "Forking…" : shown === null ? "Explore options" : `Explore ${shown} option${shown === 1 ? "" : "s"}`;
  return (
    <div className="mb-2 flex items-center gap-1">
      <button
        type="button"
        data-testid="explore-options"
        data-state={state}
        aria-disabled={inactive || undefined}
        aria-busy={state === "waiting" || state === "awaiting" || state === "busy"}
        aria-haspopup="dialog"
        className={cn(
          "relative isolate flex h-11 items-center rounded-lg px-3 text-small font-medium text-foreground outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50",
          inactive && "cursor-default",
          tip && "tip",
        )}
        data-tip={tip ?? undefined}
        data-tip-side="top"
        onClick={() => {
          if (state === "ready") onOpen();
        }}
      >
        {/* Dimmed and pulsing inside, so the tooltip (the button's ::after) stays opaque; nested, a dull button still visibly pulses. */}
        <span className={cn("flex items-center", (state === "waiting" || state === "disabled") && "opacity-50", state === "busy" && "opacity-60")} data-part="dim">
          <span className={cn("flex items-center gap-1.5", (state === "waiting" || state === "awaiting") && "animate-pulse")} data-part="pulse">
            <svg aria-hidden className="pointer-events-none absolute inset-0 -z-10 size-full">
              <defs>
                <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="var(--primary)" />
                  <stop offset="0.5" stopColor="var(--chart-2)" />
                  <stop offset="1" stopColor="var(--chart-3)" />
                </linearGradient>
              </defs>
              <rect
                data-part="border"
                x="1"
                y="1"
                rx="7"
                className={cn("explore-border", state === "disabled" && "[animation:none]")}
                style={{ width: "calc(100% - 2px)", height: "calc(100% - 2px)" }}
                fill="none"
                stroke={state === "waiting" || state === "disabled" ? "var(--muted-foreground)" : `url(#${gradient})`}
                strokeWidth="1.5"
                strokeDasharray="6 4"
              />
            </svg>
            <GitFork className="size-4" />
            {label}
          </span>
        </span>
      </button>
    </div>
  );
}

/** Why the button can't be used for this chat and reply, or null when it can (or is still looking). */
export function unavailableReason(message: MessageState | undefined, chat: { isFork: boolean; remaining: number; editing: boolean }): string | null {
  if (chat.isFork) return "A fork can't be forked again";
  if (chat.remaining <= 0) return `This chat already has ${MAX_FORKS} forks`;
  if (chat.editing) return "Not while editing a message";
  if (!message || message.role !== "assistant") return "Available after a reply";
  if (message.status === "streaming") return "Available when the reply finishes";
  if (message.status !== "done") return "Only after a finished reply";
  const stream = message.optionsStream;
  if (stream && stream.count === null) return null;
  const count = stream ? (stream.count ?? 0) : (message.options?.length ?? 0);
  return count < 2 ? "No options to explore in the last reply" : null;
}

/** The composer's slot: wires the button to the options stream, the router, the sidebar's fork count and the sheet. */
export function ExploreOptionsIsland({ chatId, message, isFork, editing }: { chatId: string; message: MessageState | undefined; isFork: boolean; editing: boolean }) {
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
  const messageId = message?.id ?? "";
  const stream = message?.optionsStream ?? null;
  const count = stream ? stream.count : (message?.options?.length ?? 0);
  const reason = unavailableReason(message, { isFork, remaining, editing });
  const fork = useCallback(
    async (chosen: readonly ForkOption[]) => {
      setBusy(true);
      setError(null);
      const out = await forkChat(store, router, chatId, messageId, chosen);
      setBusy(false);
      if (out.error) setError(out.error);
      return out;
    },
    [store, router, chatId, messageId],
  );
  const openWith = useCallback(
    (options: readonly ForkOption[]) =>
      show(({ open, close }) => <ForkSheet open={open} onOpenChange={(o) => !o && close()} messageId={messageId} options={options} remaining={remaining} onFork={fork} />),
    [show, messageId, remaining, fork],
  );
  // Whatever has arrived: the final list, else the options complete so far; none means an error instead of the sheet.
  const openCurrent = useCallback(() => {
    const m = store.getMessage(messageId);
    const options = m?.optionsStream ? m.optionsStream.partial : (m?.options ?? []);
    if (options.length > 0) openWith(options);
    else setError("Couldn't load the options. Try again in a moment.");
  }, [store, messageId, openWith]);
  // A click before the options finish waits for them (at most OPTIONS_CLICK_WAIT_MS), then opens.
  const onOpen = useCallback(() => {
    const m = store.getMessage(messageId);
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
    const unsubscribe = store.subscribeMessage(messageId, () => {
      const s = store.getMessage(messageId)?.optionsStream;
      if (!s || s.failed) finish();
    });
    const timer = setTimeout(finish, OPTIONS_CLICK_WAIT_MS);
    const stop = () => {
      unsubscribe();
      clearTimeout(timer);
      waitRef.current = null;
    };
    waitRef.current = stop;
  }, [store, messageId, openCurrent]);
  const state: ExploreState = busy ? "busy" : reason ? "disabled" : awaiting ? "awaiting" : count === null ? "waiting" : "ready";
  return (
    <>
      <ExploreOptions
        count={count}
        remaining={remaining}
        requestedAt={message?.timings?.client?.sent ?? message?.createdAt ?? 0}
        now={now}
        state={state}
        reason={reason}
        onOpen={onOpen}
      />
      {error ? (
        <p role="alert" className="mb-2 text-caption text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
}
