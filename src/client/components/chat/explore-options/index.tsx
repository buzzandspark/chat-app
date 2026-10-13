"use client";
import { GitFork } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type Ref } from "react";
import { cn } from "@/lib/utils";
import { useNow } from "@client/hooks/use-now";
import type { MessageState } from "@client/store/chat-store";
import { useChatStore } from "@client/store/hooks";
import { useSidebarChats } from "@client/store/sidebar-store";
import { CACHE_WARM_MS, MAX_FORKS, OPTIONS_CLICK_WAIT_MS, type ForkOption } from "@shared/forks";
import { useShellUser } from "@client/components/shell/shell-user";
import { chunk } from "@client/components/ui/lazy-chunk";
import { useModals } from "@client/components/ui/modal-manager";
import { ExploreOutline } from "../explore-outline";

const loadForkSheet = chunk(() => import("./fork-sheet").then((m) => m.ForkSheet));

/** On a phone with fork tabs on the input, the composer's notes (chips, this error) go below the input, so the open tab joins it. */
export const UNDER_INPUT_WITH_TABS =
  "group-has-[[data-testid=fork-tabs]]/chat:order-1 group-has-[[data-testid=fork-tabs]]/chat:mt-2 group-has-[[data-testid=fork-tabs]]/chat:mb-0 dock:group-has-[[data-testid=fork-tabs]]/chat:order-none dock:group-has-[[data-testid=fork-tabs]]/chat:mt-0 dock:group-has-[[data-testid=fork-tabs]]/chat:mb-2";

/** ready: clickable; awaiting: clicked before the options finished; busy: forking. */
type ExploreState = "ready" | "awaiting" | "busy";

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
  const tip = expired ? "Forks now start slower and cost more" : null;
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
          <ExploreOutline marching={state !== "ready"} rotating={shown} />
          <GitFork className="size-4" />
          {label}
        </span>
      </button>
    </div>
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
      // Fetched when the sheet opened (openWith), so this resolves at once.
      const { forkChat } = await import("@client/store/fork-chat");
      const out = await forkChat(store, router, chatId, messageId, chosen, () => {
        const from = buttonRef.current?.getBoundingClientRect();
        closeSheet();
        // Started before the forks are listed: the strip's own import of the chunk resolves after this one.
        if (from) void import("../tab-reveal").then((m) => m.startTabReveal(chatId, from));
      });
      setBusy(false);
      if (out.error) setError(out.error);
      return out;
    },
    [store, router, chatId, messageId],
  );
  const openWith = useCallback(
    (options: readonly ForkOption[]) => {
      void import("../tab-reveal");
      void import("@client/store/fork-chat");
      loadForkSheet().then(
        (ForkSheet) => show(({ open, close }) => <ForkSheet open={open} onOpenChange={(o) => !o && close()} messageId={messageId} options={options} onFork={fork} />),
        () => setError("Couldn't open the options. Try again."),
      );
    },
    [show, messageId, fork],
  );
  // Whatever has arrived: the final list, else the options complete so far; none means an error instead of the sheet.
  // Only a stream still running can bring options to a later click; a failed one isn't fetched again.
  const openCurrent = useCallback(() => {
    const m = store.getMessage(messageId);
    const options = m?.optionsStream ? m.optionsStream.partial : (m?.options ?? []);
    if (options.length > 0) openWith(options);
    else setError(m?.optionsStream && !m.optionsStream.failed ? "Couldn't load the options. Try again in a moment." : "Couldn't load the options.");
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
          requestedAt={message?.createdAt ?? 0}
          now={now}
          state={state}
          onOpen={onOpen}
        />
      )}
      {error ? (
        <p role="alert" className={cn("mb-2 text-caption text-destructive", UNDER_INPUT_WITH_TABS)}>
          {error}
        </p>
      ) : null}
    </>
  );
}
