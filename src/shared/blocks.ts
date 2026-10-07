import type Anthropic from "@anthropic-ai/sdk";

/** What `messages.content` stores: the API's content blocks, fallback blocks kept in place (D8). */
export type StoredContentBlock = Anthropic.Beta.BetaContentBlock;
export type IterationUsage = NonNullable<Anthropic.Beta.BetaUsage["iterations"]>;

/** What the client renders; a divider marks a mid-stream fallback (D12). Tool use collapses to nothing. */
export type ClientBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string; redacted?: boolean }
  | { type: "divider"; from: string; to: string; category: string | null };

export function toClientBlocks(content: readonly StoredContentBlock[]): ClientBlock[] {
  const out: ClientBlock[] = [];
  let hasText = false;
  for (const block of content) {
    switch (block.type) {
      case "text":
        out.push({ type: "text", text: block.text });
        if (block.text.length > 0) hasText = true;
        break;
      case "thinking":
        out.push({ type: "thinking", text: block.thinking });
        break;
      case "redacted_thinking":
        out.push({ type: "thinking", text: "", redacted: true });
        break;
      case "fallback":
        // The live stream shows a divider only after text was painted; a saved reply reads the same way (#67).
        if (hasText) {
          out.push({
            type: "divider",
            from: block.from.model,
            to: block.to.model,
            category: block.trigger?.category ?? null,
          });
        }
        break;
      default:
        break;
    }
  }
  return out;
}

export function plainText(content: readonly StoredContentBlock[]): string {
  let s = "";
  for (const block of content) if (block.type === "text") s += block.text;
  return s;
}
