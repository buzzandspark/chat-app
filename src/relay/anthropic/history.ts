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

/**
 * One stored assistant message to request params (D9, D12). Thinking blocks
 * are echoed unchanged so same-model turns keep their reasoning and the API
 * drops what a different serving model cannot read. Blocks before the final
 * `fallback` block that are not text are omitted, because the fallback model
 * only ever saw the text before the boundary. Thinking blocks without a
 * signature (an interrupted stream) are dropped: the API rejects them.
 */
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

export function userParams(content: readonly StoredContentBlock[]): Param[] {
  const out: Param[] = [];
  for (const block of content) if (block.type === "text") out.push({ type: "text", text: block.text });
  return out;
}

/**
 * Stored messages to `MessageParam[]` (D9, D13). Refused assistant messages
 * are excluded (their partial text was discarded), as are assistant messages
 * that ended up with no usable content. A trailing-whitespace text block is
 * trimmed so no turn can be mistaken for a prefill. The newest user message
 * carries the moving cache breakpoint; the system prompt carries the fixed
 * one (see request.ts).
 */
export function buildHistory(messages: readonly HistoryMessage[]): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of messages) {
    if (m.role === "assistant") {
      if (m.status === "refused" || m.status === "error") continue;
      const content = assistantParams(m.content);
      if (!content.some((b) => b.type !== "fallback")) continue;
      // Collapse a fallback-only tail and trim trailing whitespace on the last text block.
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
  // Moving breakpoint on the newest user message (the 20-position lookback finds the previous one).
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i]!;
    if (m.role !== "user" || typeof m.content === "string") continue;
    const lastBlock = m.content[m.content.length - 1];
    if (lastBlock && lastBlock.type === "text") {
      lastBlock.cache_control = { type: "ephemeral" };
    }
    break;
  }
  return out;
}
