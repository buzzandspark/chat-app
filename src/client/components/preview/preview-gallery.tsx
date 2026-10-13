"use client";
import { useMemo, useState } from "react";
import { useNow } from "@client/hooks/use-now";
import { Markdown } from "@client/markdown/Markdown";
import { createMessageState } from "@client/store/chat-store";
import { ChatStoreProvider } from "@client/store/context";
import { ThinkingBlock } from "../chat/assistant-message/thinking-block";
import { StatusFooter } from "../chat/assistant-message/status-footer";
import { UserMessage } from "../chat/user-message";

const SAMPLE_MD = `## Heading\n\nSome **bold** and _italic_ text with \`code\`.\n\n- one\n- two\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n\`\`\`ts\nconst x: number = 1;\n\`\`\``;

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-caption uppercase tracking-wide text-muted-foreground">{title}</h2>
      <div className="w-[390px] rounded-xl border border-border bg-background p-4 shadow-sm">{children}</div>
    </section>
  );
}

/** Components in isolation at 390 px; every state the chat can show, side by side. */
export function PreviewGallery() {
  const [dark, setDark] = useState(false);
  const now = useNow(1000);
  const states = useMemo(
    () =>
      [
        createMessageState({ id: "1", chatId: "c", role: "assistant", status: "stopped" }),
        createMessageState({ id: "2", chatId: "c", role: "assistant", status: "interrupted", interruptedReason: "shutdown" }),
        createMessageState({ id: "3", chatId: "c", role: "assistant", status: "error", error: { kind: "rate_limited", message: "", retryable: true, retryAfterMs: 20_000 } }),
        createMessageState({ id: "4", chatId: "c", role: "assistant", status: "error", error: { kind: "quota_exceeded", message: "", retryable: false } }),
        createMessageState({ id: "5", chatId: "c", role: "assistant", status: "error", error: { kind: "context_full", message: "", retryable: false } }),
        createMessageState({ id: "6", chatId: "c", role: "assistant", status: "refused", refusal: { category: "cyber", explanation: "This could enable cyber harm." } }),
        createMessageState({ id: "7", chatId: "c", role: "assistant", status: "refused", refusal: { category: null, explanation: null } }),
        createMessageState({ id: "8", chatId: "c", role: "assistant", status: "done", stopReason: "max_tokens" }),
        createMessageState({ id: "9", chatId: "c", role: "assistant", status: "streaming", connection: "reconnecting", reconnectAttempt: 2 }),
        createMessageState({ id: "10", chatId: "c", role: "assistant", status: "streaming", connection: "offline" }),
      ] as const,
    [],
  );
  return (
    <ChatStoreProvider>
    <main className={dark ? "dark" : ""}>
      <div className="min-h-dvh space-y-6 bg-muted p-4 text-foreground">
        <button type="button" className="touch-target rounded-lg border border-border bg-background px-3" onClick={() => setDark((d) => !d)}>
          Toggle {dark ? "light" : "dark"}
        </button>
        <Frame title="User message">
          <UserMessage message={createMessageState({ id: "u", chatId: "c", role: "user", blocks: [{ type: "text", text: "How does resume work on a dropped connection?" }] })} />
        </Frame>
        <Frame title="Thinking (open, streaming)">
          <ThinkingBlock text="Planning the answer…" streaming startedAt={now - 3000} endedAt={null} collapseSignal={false} />
        </Frame>
        <Frame title="Markdown">
          <Markdown text={SAMPLE_MD} streaming={false} />
        </Frame>
        <Frame title="Unclosed fence (streaming)">
          <Markdown text={"Here:\n\n```ts\nconst partial = tru"} streaming className="streaming-caret" />
        </Frame>
        {states.map((m) => (
          <Frame key={m.id} title={`Footer: ${m.status}${m.error ? ` / ${m.error.kind}` : ""}${m.interruptedReason ? ` / ${m.interruptedReason}` : ""}${m.connection !== "idle" ? ` / ${m.connection}` : ""}`}>
            <StatusFooter message={m} onRetry={() => {}} onContinue={() => {}} onResume={() => {}} />
          </Frame>
        ))}
      </div>
    </main>
    </ChatStoreProvider>
  );
}
