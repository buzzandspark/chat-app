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

/**
 * D11, checked against the bundled Claude API reference on 2026-10-06.
 *
 * Sonnet 5.5 and Opus 5.5: adaptive thinking with summarized display, effort
 * `low` by default and `high` for "Think harder", server-side fallbacks in
 * the `"default"` form, and `drop_block` so a system-prompt edit on deploy
 * degrades existing chats instead of turning them into 400s (the binding
 * check covers the system prompt and tools and is enforced for API accounts
 * created on or after 2026-08-31).
 *
 * Haiku 4.5: `thinking: { type: "enabled", budget_tokens }` when toggled,
 * nothing otherwise, and none of the betas.
 */
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
