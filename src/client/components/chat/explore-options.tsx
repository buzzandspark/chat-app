"use client";
import { GitFork } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type Ref } from "react";
import { cn } from "@/lib/utils";
import { useNow } from "@client/hooks/use-now";
import type { MessageState } from "@client/store/chat-store";
import { forkChat } from "@client/store/forks";
import { useChatStore } from "@client/store/hooks";
import { useSidebarChats } from "@client/store/sidebar-store";
import { CACHE_WARM_MS, MAX_FORKS, OPTIONS_CLICK_WAIT_MS, type ForkOption } from "@shared/forks";
import { useShellUser } from "../shell/shell-user";
import { lazyChunk } from "../ui/lazy-chunk";
import { useModals } from "../ui/modal-manager";

const ForkSheet = lazyChunk(() => dynamic(() => import("./fork-sheet").then((m) => m.ForkSheet), { ssr: false }));

/** ready: clickable; awaiting: clicked before the options finished; busy: forking. */
export type ExploreState = "ready" | "awaiting" | "busy";

export interface ExploreOptionsProps {
  shown: boolean;
  /** How many options can be forked, kept while the button tucks away. */
  count: number;
  /** When the reply's request started, on this client's clock where known. */
  requestedAt: number;
  now: number;
  state: ExploreState;
  onOpen: () => void;
  ref?: Ref<HTMLButtonElement>;
}

/** Pops up from behind the composer's top border while the last reply has options, to where Jump to latest sits. */
export function ExploreOptions({ shown, count, requestedAt, now, state, onOpen, ref }: ExploreOptionsProps) {
  const expired = state === "ready" && now > 0 && now - requestedAt > CACHE_WARM_MS;
  const tip = expired ? "Cache expired: the first fork re-sends the whole chat" : null;
  const label = state === "busy" ? "Forking…" : `Explore ${count} option${count === 1 ? "" : "s"}`;
  return (
    // Clipped only below, at the border's top edge, so the button rises out from behind it and the tooltip above stays whole.
    <div
      className="pointer-events-none absolute inset-x-0 bottom-[calc(100%+1px)] flex justify-center pb-3 [clip-path:inset(-100vh_-100vw_0_-100vw)]"
      data-explore={shown ? "shown" : "hidden"}
      inert={!shown}
    >
      <button
        ref={ref}
        type="button"
        data-testid="explore-options"
        data-state={state}
        aria-disabled={state === "busy" || undefined}
        aria-busy={state !== "ready"}
        aria-haspopup="dialog"
        className={cn(
          "pointer-events-auto relative isolate flex h-11 items-center rounded-lg bg-background px-3 text-small font-medium text-foreground shadow-md outline-none select-none transition-[translate,visibility] focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none",
          shown ? "duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]" : "invisible translate-y-[calc(100%+0.75rem)] duration-200 ease-in",
          state === "busy" && "cursor-default",
          tip && "tip",
        )}
        data-tip={tip ?? undefined}
        data-tip-side="top"
        onClick={() => {
          if (shown && state === "ready") onOpen();
        }}
      >
        {/* Dimmed and pulsing inside, so the tooltip (the button's ::after) stays opaque. */}
        <span className={cn("flex items-center gap-1.5", state === "awaiting" && "animate-pulse", state === "busy" && "opacity-60")} data-part="label">
          <ExploreOutline marching={state !== "ready"} />
          <GitFork className="size-4" />
          {label}
        </span>
      </button>
    </div>
  );
}

/** The button's dashed gradient outline, drawn behind its content; the tab strip's reveal starts from it too. */
export function ExploreOutline({ marching = false }: { marching?: boolean }) {
  const gradient = useId();
  return (
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
        // The animation lives in an unlayered rule that no utility can override, so the class itself is the switch.
        className={marching ? "explore-border" : undefined}
        style={{ width: "calc(100% - 2px)", height: "calc(100% - 2px)" }}
        fill="none"
        stroke={`url(#${gradient})`}
        strokeWidth="1.5"
        strokeDasharray="6 4"
      />
    </svg>
  );
}

/** Whether the last reply has options this chat can still fork: the only time the button is up. */
export function optionsFound(message: MessageState | undefined, chat: { isFork: boolean; forks: number; editing: boolean }): boolean {
  // A chat with forks shows its tabs here instead.
  if (chat.isFork || chat.forks > 0 || chat.editing) return false;
  if (message?.role !== "assistant" || message.status !== "done") return false;
  const count = message.optionsStream ? message.optionsStream.count : (message.options?.length ?? 0);
  return count !== null && count >= 2;
}

/** The composer's overlay: wires the button to the options stream, the router, the sidebar's fork count and the sheet. */
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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { exploreOptions } = useShellUser();
  const messageId = message?.id ?? "";
  const found = exploreOptions && optionsFound(message, { isFork, forks, editing });
  const count = Math.min(message?.optionsStream ? (message.optionsStream.count ?? 0) : (message?.options?.length ?? 0), MAX_FORKS);
  // The last count shown, so the label doesn't change while the button tucks away.
  const [shownCount, setShownCount] = useState(count);
  if (found && count !== shownCount) setShownCount(count);
  // A wait for the options ends when the button tucks away (a new message, an edit) or the view hides.
  useEffect(() => {
    const wait = waitRef;
    return () => wait.current?.();
  }, [found]);
  const fork = useCallback(
    async (chosen: readonly ForkOption[], closeSheet: () => void) => {
      setBusy(true);
      setError(null);
      // The strip that replaces the button grows out of it, once the sheet is out of the way.
      const out = await forkChat(store, router, chatId, messageId, chosen, () => {
        const from = buttonRef.current?.getBoundingClientRect();
        closeSheet();
        // Started before the forks are listed: the strip's own import of the chunk resolves after this one.
        if (from) void import("./tab-reveal").then((m) => m.startTabReveal(chatId, from));
      });
      setBusy(false);
      if (out.error) setError(out.error);
      return out;
    },
    [store, router, chatId, messageId],
  );
  const openWith = useCallback(
    (options: readonly ForkOption[]) => {
      void import("./tab-reveal");
      show(({ open, close }) => <ForkSheet open={open} onOpenChange={(o) => !o && close()} messageId={messageId} options={options} onFork={fork} />);
    },
    [show, messageId, fork],
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
      setAwaiting(false);
    };
    waitRef.current = stop;
  }, [store, messageId, openCurrent]);
  const state: ExploreState = busy ? "busy" : awaiting ? "awaiting" : "ready";
  return (
    <>
      {forks > 0 ? null : (
        <ExploreOptions
          ref={buttonRef}
          shown={busy || found}
          count={shownCount}
          requestedAt={message?.timings?.client?.sent ?? message?.createdAt ?? 0}
          now={now}
          state={state}
          onOpen={onOpen}
        />
      )}
      {error ? (
        <p role="alert" className="mb-2 text-caption text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
}
