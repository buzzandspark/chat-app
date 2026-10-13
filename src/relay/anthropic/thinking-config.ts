import type Anthropic from "@anthropic-ai/sdk";
import type { ModelId, ThinkingOptions } from "@shared/types";

export const MAX_TOKENS = 16_000;
/** Thinking included: with the guest prompt cap it bounds what one guest reply can cost. */
export const GUEST_MAX_TOKENS = 8192;

const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const BINDING_BETA = "thinking-binding-controls-2026-08-01";

export interface ModelParams {
  thinking?: Anthropic.Beta.BetaThinkingConfigParam;
  output_config?: Anthropic.Beta.BetaOutputConfig;
  betas: string[];
  fallbacks?: "default";
}

// Checked against the Claude API reference on 2026-10-06. drop_block keeps chats with thinking
// blocks working when the system prompt changes; the binding check is enforced for accounts created on or after 2026-08-31.
export function modelParams(model: ModelId, opts: ThinkingOptions): ModelParams {
  switch (model) {
    case "claude-sonnet-5-5":
    case "claude-opus-5-5":
      return {
        thinking: {
          type: "adaptive",
          display: "summarized",
          block_binding: { prefix_mismatch_behavior: "drop_block" },
        },
        output_config: { effort: opts.effort },
        betas: [FALLBACK_BETA, BINDING_BETA],
        fallbacks: "default",
      };
    case "claude-haiku-5-5":
      // Adaptive thinking steered by effort, bound thinking blocks; no server-side fallback is documented for it.
      return {
        thinking: {
          type: "adaptive",
          display: "summarized",
          block_binding: { prefix_mismatch_behavior: "drop_block" },
        },
        output_config: { effort: opts.effort },
        betas: [BINDING_BETA],
      };
  }
}
