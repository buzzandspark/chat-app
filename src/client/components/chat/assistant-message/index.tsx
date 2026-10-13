"use client";
import { useEffect } from "react";
import { useMarkdownComponent } from "@client/markdown/ready";
import { cn } from "@/lib/utils";
import { canRetryReply, textOf, type MessageState } from "@client/store/chat-store";
import { useChat, useChatStore } from "@client/store/hooks";
import { modelDisplayName } from "@shared/models";
import { ChunkBoundary } from "@client/components/ui/chunk-boundary";
import { useChatActions, useChatLiveState } from "../chat-context";
import { isLongWait, MAX_AUTO_RETRIES, rateLimitDelayMs } from "@client/store/rate-limit";
import { StatusFooter } from "./status-footer";
import { ThinkingBlock } from "./thinking-block";
import { AssistantActionsOnIntent } from "./actions-trigger";

// The Markdown renderer (marked, 14 kB gzipped) is its own chunk, fetched when the route's JS evaluates and on a send;
// until it is in (markdown/ready.ts), or if it fails to load, the text is plain.
function PlainText({ text, className }: { text: string; streaming: boolean; className?: string }) {
  return <div className={cn("min-w-0 max-w-full whitespace-pre-wrap break-words text-body", className)}>{text}</div>;
}

function ModelDivider({ from, to }: { from: string; to: string }) {
  return (
    <div className="my-3 flex items-center gap-3 text-caption text-muted-foreground" role="separator">
      <span className="h-px flex-1 bg-border" />
      <span>
        Switched from {modelDisplayName(from)} to {modelDisplayName(to)} for safety
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/** Only rows with a thinking block subscribe to the follow state, so a scroll re-renders those alone. */
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
  const Markdown = useMarkdownComponent() ?? PlainText;
  const text = textOf(message.blocks);
  const hasText = text.length > 0;

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

  // A 429 retries itself with exponential backoff, four times at most, only for a reply this client asked for.
  // The timer dies with the row, so hiding the chat, a manual Retry, or a later send all cancel it.
  const rateLimited = message.status === "error" && message.error?.kind === "rate_limited" && message.local && retryable && !isLongWait(message.error.retryAfterMs);
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
                  // Opening a block to read it must not be scrolled away by the follow.
                  if (open && streaming) autoFollow.disengage();
                }}
              />
            );
          }
          if (block.type === "divider") return <ModelDivider key={i} from={block.from} to={block.to} />;
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
          <div className="flex h-7 items-center">
            <span className="size-2 animate-pulse rounded-full bg-muted-foreground" />
          </div>
        ) : null}
      </div>
      {discarded ? <span className="text-caption text-muted-foreground">Incomplete. Claude won&apos;t see this part in later replies.</span> : null}
      <StatusFooter
        message={message}
        onRetry={retryable ? onRetry : undefined}
        onContinue={() => send("Continue.", message.scenario ?? undefined)}
        onResume={() => client.resumeAll()}
      />
      {/* Reserved while streaming, so the pinned end does not jump when the actions row mounts. */}
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
