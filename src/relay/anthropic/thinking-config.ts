import type Anthropic from "@anthropic-ai/sdk";
import type { ModelId, ThinkingOptions } from "@shared/types";

export const MAX_TOKENS = 16_000;

export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
export const BINDING_BETA = "thinking-binding-controls-2026-08-01";

export interface ModelParams {
  thinking?: Anthropic.Beta.BetaThinkingConfigParam;
  output_config?: Anthropic.Beta.BetaOutputConfig;
  betas: string[];
  fallbacks?: "default";
}

// D11, checked against the Claude API reference on 2026-10-06. drop_block keeps chats with thinking
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
        output_config: { effort: opts.harder ? "high" : "low" },
        betas: [FALLBACK_BETA, BINDING_BETA],
        fallbacks: "default",
      };
    case "claude-haiku-4-5":
      return {
        thinking: opts.harder ? { type: "enabled", budget_tokens: 2048 } : undefined,
        betas: [],
      };
  }
}
