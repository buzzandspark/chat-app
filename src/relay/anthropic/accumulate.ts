import type Anthropic from "@anthropic-ai/sdk";
import type { StoredContentBlock } from "@shared/blocks";
import type { StreamAccumulator } from "./parse-stream";

/** Content blocks to persist, fallback blocks in place; callable at any point in the stream (D9). */
export function toContentBlocks(acc: StreamAccumulator): StoredContentBlock[] {
  const out: StoredContentBlock[] = [];
  for (const index of acc.order) {
    const b = acc.blocks.get(index);
    if (!b) continue;
    switch (b.type) {
      case "text":
        if (b.text.length > 0) out.push({ type: "text", text: b.text, citations: null });
        break;
      case "thinking":
        if (b.thinking.length > 0 || b.signature.length > 0) {
          out.push({ type: "thinking", thinking: b.thinking, signature: b.signature });
        }
        break;
      case "redacted_thinking":
        out.push({ type: "redacted_thinking", data: b.data });
        break;
      case "tool_use": {
        let input: unknown = {};
        if (b.partialJson) {
          try {
            input = JSON.parse(b.partialJson);
          } catch {
            input = { __partial: b.partialJson };
          }
        }
        out.push({ type: "tool_use", id: b.toolId, name: b.toolName, input } as Anthropic.Beta.BetaToolUseBlock);
        break;
      }
      case "fallback":
        if (b.fallback) {
          out.push({
            type: "fallback",
            from: { model: b.fallback.from },
            to: { model: b.fallback.to },
            trigger: { type: "refusal", category: b.fallback.category },
          } as Anthropic.Beta.BetaFallbackBlock);
        }
        break;
      default:
        break;
    }
  }
  return out;
}
