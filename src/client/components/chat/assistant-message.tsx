"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Markdown } from "@client/markdown/Markdown";
import { textOf, type MessageState } from "@client/store/chat-store";
import { useChat, useChatStore } from "@client/store/hooks";
import { modelDisplayName } from "@shared/models";
import { useChatContext } from "./chat-context";
import { StatusFooter } from "./status-footer";
import { ThinkingBlock } from "./thinking-block";

// D21: menus and popovers (Radix) load after first paint, not in the route bundle.
const AssistantActions = dynamic(() => import("./assistant-actions").then((m) => m.AssistantActions), {
  ssr: false,
  loading: () => <div className="h-11" aria-hidden />,
});

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

export function AssistantMessage({ message }: { message: MessageState }) {
  const { chatId, client, retry, send, autoFollow } = useChatContext();
  const store = useChatStore();
  const chat = useChat(chatId);
  const streaming = message.status === "streaming";
  const text = textOf(message.blocks);
  const hasText = text.length > 0;
  const paintedRef = useRef(false);

  // D20: first paint is measured in a task after the committing frame.
  useEffect(() => {
    if (!hasText || paintedRef.current) return;
    paintedRef.current = true;
    const id = message.id;
    const raf = requestAnimationFrame(() => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => store.markClientTiming(id, "firstPaint");
      channel.port2.postMessage(0);
    });
    return () => cancelAnimationFrame(raf);
  }, [hasText, message.id, store]);

  const userMessageId = (() => {
    const index = chat.messageIds.indexOf(message.id);
    for (let i = index - 1; i >= 0; i--) {
      const m = store.getMessage(chat.messageIds[i]!);
      if (m?.role === "user") return m.id;
    }
    return null;
  })();

  const onRetry = () => {
    if (userMessageId) retry(userMessageId, message.id);
  };

  const discarded = message.discardedText;
  const hasTextBlock = message.blocks.some((b) => b.type === "text");
  const hasThinkingBlock = message.blocks.some((b) => b.type === "thinking");

  return (
    <div className="group/message flex flex-col items-start gap-1" data-testid="assistant-message">
      <div className={cn("w-full min-w-0", discarded && "opacity-50")}>
        {message.blocks.map((block, i) => {
          if (block.type === "thinking") {
            return (
              <ThinkingBlock
                key={i}
                text={block.text}
                redacted={block.redacted}
                streaming={streaming}
                startedAt={message.thinkingStartedAt}
                endedAt={message.thinkingEndedAt}
                collapseSignal={hasText && autoFollow.engaged}
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
        onRetry={onRetry}
        onContinue={() => send("Continue.")}
        onResume={() => client.resumeAll()}
      />
      {!streaming ? (
        <AssistantActions
          message={message}
          text={text}
          canRegenerate={Boolean(userMessageId) && message.status !== "refused"}
          onRegenerate={onRetry}
        />
      ) : null}
    </div>
  );
}
