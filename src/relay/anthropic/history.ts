import type Anthropic from "@anthropic-ai/sdk";
import type { StoredContentBlock } from "@shared/blocks";
import type { MessageStatus } from "@shared/types";

export interface HistoryMessage {
  role: "user" | "assistant";
  content: readonly StoredContentBlock[];
  status: MessageStatus;
}

type Param = Anthropic.Beta.BetaContentBlockParam;

function lastFallbackIndex(content: readonly StoredContentBlock[]): number {
  for (let i = content.length - 1; i >= 0; i--) if (content[i]!.type === "fallback") return i;
  return -1;
}

// Non-text blocks before the final fallback block are omitted: the fallback model never saw them (D9).
// Thinking without a signature (an interrupted stream) is dropped: the API rejects it.
export function assistantParams(content: readonly StoredContentBlock[]): Param[] {
  const boundary = lastFallbackIndex(content);
  const out: Param[] = [];
  content.forEach((block, i) => {
    const beforeBoundary = boundary !== -1 && i < boundary;
    switch (block.type) {
      case "text":
        if (block.text.length > 0) out.push({ type: "text", text: block.text });
        break;
      case "thinking":
        if (!beforeBoundary && block.signature) {
          out.push({ type: "thinking", thinking: block.thinking, signature: block.signature });
        }
        break;
      case "redacted_thinking":
        if (!beforeBoundary) out.push({ type: "redacted_thinking", data: block.data });
        break;
      case "tool_use":
        if (!beforeBoundary) {
          out.push({ type: "tool_use", id: block.id, name: block.name, input: block.input });
        }
        break;
      case "fallback":
        out.push({ type: "fallback", from: { model: block.from.model }, to: { model: block.to.model } });
        break;
      default:
        break;
    }
  });
  return out;
}

function userParams(content: readonly StoredContentBlock[]): Param[] {
  const out: Param[] = [];
  for (const block of content) if (block.type === "text") out.push({ type: "text", text: block.text });
  return out;
}

export interface HistoryOptions {
  /** Also mark the final assistant message, so requests that share it as a prefix (forks) read one entry. */
  cacheTail?: boolean;
}

// Refused and errored assistant messages are excluded (D9); trailing whitespace is trimmed so no
// turn reads as a prefill; the newest user message carries the moving cache breakpoint (D13).
export function buildHistory(messages: readonly HistoryMessage[], options: HistoryOptions = {}): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of messages) {
    if (m.role === "assistant") {
      if (m.status === "refused" || m.status === "error") continue;
      const content = assistantParams(m.content);
      if (!content.some((b) => b.type !== "fallback")) continue;
      const last = content[content.length - 1];
      if (last && last.type === "text") last.text = last.text.trimEnd();
      if (last && last.type === "text" && last.text.length === 0) content.pop();
      if (content.length === 0) continue;
      out.push({ role: "assistant", content });
    } else {
      const content = userParams(m.content);
      if (content.length === 0) continue;
      out.push({ role: "user", content });
    }
  }
  if (options.cacheTail) markLast(out, "assistant");
  // Moving breakpoint on the newest user message (the 20-position lookback finds the previous one).
  markLast(out, "user");
  return out;
}

function markLast(out: Anthropic.Beta.BetaMessageParam[], role: "user" | "assistant"): void {
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i]!;
    if (m.role !== role || typeof m.content === "string") continue;
    const lastBlock = m.content[m.content.length - 1];
    if (lastBlock && lastBlock.type === "text") lastBlock.cache_control = { type: "ephemeral" };
    break;
  }
}
