"use client";
import { MoreHorizontal, Timer } from "lucide-react";
import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { intentProps, useIntent } from "@client/hooks/use-lazy-on-intent";
import { useMarkdownComponent } from "@client/markdown/ready";
import { IconButton } from "../ui/icon-button";
import { cn } from "@/lib/utils";
import { canRetryReply, textOf, type MessageState } from "@client/store/chat-store";
import { useChat, useChatStore } from "@client/store/hooks";
import { modelDisplayName } from "@shared/models";
import { ChunkBoundary } from "../ui/chunk-boundary";
import { lazyChunk } from "../ui/lazy-chunk";
import { useChatActions, useChatLiveState } from "./chat-context";
import { MAX_AUTO_RETRIES, rateLimitDelayMs } from "./rate-limit";
import { ServedBy, StatusFooter } from "./status-footer";
import { ThinkingBlock } from "./thinking-block";

// D21: menus and popovers (Radix) load on first intent, not at mount; the stand-ins keep the row's height.
const ACTION_BUTTON =
  "text-muted-foreground hover:bg-foreground/10 hover:text-foreground aria-expanded:bg-foreground/10 aria-expanded:text-foreground dark:hover:bg-foreground/15 dark:aria-expanded:bg-foreground/15 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/message:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100";

function ActionsStandIn({
  message,
  intent,
  onPress,
}: {
  message: MessageState;
  intent?: { warmUp: () => void };
  onPress?: (what: string) => void;
}) {
  return (
    <div className="flex items-center gap-1" {...(intent ? intentProps(intent) : {})}>
      <ServedBy message={message} />
      <IconButton label="Latency breakdown" className="text-muted-foreground" disabled={!onPress} onClick={() => onPress?.("latency")}>
        <Timer />
      </IconButton>
      <IconButton label="Message actions" className={ACTION_BUTTON} disabled={!onPress} onClick={() => onPress?.("menu")}>
        <MoreHorizontal />
      </IconButton>
    </div>
  );
}
const AssistantActions = lazyChunk(() =>
  dynamic(() => import("./assistant-actions").then((m) => m.AssistantActions), {
    ssr: false,
    loading: () => <div className="h-11" aria-hidden />,
  }),
);

const warmAssistantActions = () => import("./assistant-actions");

// #83: the Markdown renderer (marked, 14 kB gzipped) is its own chunk, fetched when the route's JS
// evaluates and warmed again by a send. Once it is in, rows render it directly (markdown/ready.ts);
// this lazy wrapper serves only a live first reply whose tokens beat the chunk.
const MarkdownLazy = dynamic(() => import("@client/markdown/Markdown").then((m) => m.Markdown), { ssr: true, loading: () => null });

function AssistantActionsOnIntent(props: { message: MessageState; text: string; canRegenerate: boolean; onRegenerate: () => void }) {
  const intent = useIntent(warmAssistantActions);
  if (intent.armed) {
    return <AssistantActions {...props} defaultOpen={intent.wanted === "menu" || intent.wanted === "latency" ? intent.wanted : null} />;
  }
  return <ActionsStandIn message={props.message} intent={intent} onPress={intent.press} />;
}

function ModelDivider({ from, to, category }: { from: string; to: string; category: string | null }) {
  return (
    <div className="my-3 flex items-center gap-3 text-caption text-muted-foreground" role="separator">
      <span className="h-px flex-1 bg-border" />
      <span>
        Served by {modelDisplayName(to)} after a safety fallback{category ? ` (${category})` : ""} from {modelDisplayName(from)}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/** Only rows with a thinking block subscribe to the follow state, so a scroll re-renders those alone (#43). */
function ThinkingBlockFollowing({
  hasText,
  ...props
}: Omit<Parameters<typeof ThinkingBlock>[0], "collapseSignal"> & { hasText: boolean }) {
  const { followEngaged } = useChatLiveState();
  return <ThinkingBlock {...props} collapseSignal={hasText && followEngaged} />;
}

export function AssistantMessage({ message }: { message: MessageState }) {
  const { chatId, client, retry, send, autoFollow } = useChatActions();
  const store = useChatStore();
  const chat = useChat(chatId);
  const streaming = message.status === "streaming";
  const Markdown = useMarkdownComponent() ?? MarkdownLazy;
  const text = textOf(message.blocks);
  const hasText = text.length > 0;
  const paintedRef = useRef(false);

  // D20: first paint is measured in a task after the committing frame, only for a reply this client sent (#46).
  const sentHere = message.timings?.client?.sent !== undefined && message.timings.client.firstPaint === undefined;
  useEffect(() => {
    if (!hasText || !sentHere || paintedRef.current) return;
    paintedRef.current = true;
    const id = message.id;
    const raf = requestAnimationFrame(() => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => store.markClientTiming(id, "firstPaint");
      channel.port2.postMessage(0);
    });
    return () => cancelAnimationFrame(raf);
  }, [hasText, sentHere, message.id, store]);

  const userMessageId = (() => {
    const index = chat.messageIds.indexOf(message.id);
    for (let i = index - 1; i >= 0; i--) {
      const m = store.getMessage(chat.messageIds[i]!);
      if (m?.role === "user") return m.id;
    }
    return null;
  })();

  // A failed reply with a newer turn after it keeps its error but offers no retry (canRetryReply).
  const retryable = canRetryReply(chat, message);
  const onRetry = () => {
    if (userMessageId) retry(userMessageId, message.id);
  };

  // A 429 retries by itself with exponential backoff, four times at most, and only for a reply this
  // client asked for (a saved error from an earlier session waits for the user). The timer dies with
  // the row, so a hidden chat pauses and a manual Try again, which replaces the row, cancels it; a
  // send after the error stops it too, since the reply is then no longer the last turn.
  const rateLimited = message.status === "error" && message.error?.kind === "rate_limited" && message.local && retryable;
  const attempt = message.retryAttempt;
  const retryAfterMs = message.error?.retryAfterMs;
  const createdAt = message.createdAt;
  const messageId = message.id;
  useEffect(() => {
    if (!rateLimited || attempt >= MAX_AUTO_RETRIES || !userMessageId) return;
    const delay = Math.max(0, createdAt + rateLimitDelayMs(attempt, retryAfterMs) - Date.now());
    const timer = setTimeout(() => retry(userMessageId, messageId), delay);
    return () => clearTimeout(timer);
  }, [rateLimited, attempt, retryAfterMs, createdAt, messageId, userMessageId, retry]);

  const discarded = message.discardedText;
  const hasTextBlock = message.blocks.some((b) => b.type === "text");
  const hasThinkingBlock = message.blocks.some((b) => b.type === "thinking");

  return (
    <div className="group/message flex flex-col items-start gap-1" data-testid="assistant-message">
      <div className={cn("w-full min-w-0", discarded && "opacity-50")}>
        {message.blocks.map((block, i) => {
          if (block.type === "thinking") {
            return (
              <ThinkingBlockFollowing
                key={i}
                text={block.text}
                redacted={block.redacted}
                streaming={streaming}
                startedAt={message.thinkingStartedAt}
                endedAt={message.thinkingEndedAt}
                hasText={hasText}
                onUserToggle={(open) => {
                  // Opening a block to read it must not be scrolled away by the follow (#27).
                  if (open && streaming) autoFollow.disengage();
                }}
              />
            );
          }
          if (block.type === "divider") return <ModelDivider key={i} from={block.from} to={block.to} category={block.category} />;
          const isLast = i === message.blocks.length - 1;
          return (
            <Markdown
              key={i}
              text={block.text}
              streaming={streaming && isLast}
              className={cn(streaming && isLast && "streaming-caret")}
            />
          );
        })}
        {streaming && !hasTextBlock && !hasThinkingBlock ? (
          <div className="flex h-7 items-center" aria-label="Waiting for the first token">
            <span className="size-2 animate-pulse rounded-full bg-muted-foreground" />
          </div>
        ) : null}
      </div>
      {discarded ? <span className="text-caption text-muted-foreground">Incomplete and not saved.</span> : null}
      <StatusFooter
        message={message}
        onRetry={retryable ? onRetry : undefined}
        onContinue={() => send("Continue.", message.scenario ?? undefined)}
        onResume={() => client.resumeAll()}
      />
      {/* The actions row's height is reserved while streaming, so the pinned end does not jump when it mounts (#78). */}
      <div className="min-h-11">
        {!streaming ? (
          <ChunkBoundary label="message actions">
            <AssistantActionsOnIntent
              message={message}
              text={text}
              canRegenerate={Boolean(userMessageId) && retryable && message.status !== "refused"}
              onRegenerate={onRetry}
            />
          </ChunkBoundary>
        ) : null}
      </div>
    </div>
  );
}
