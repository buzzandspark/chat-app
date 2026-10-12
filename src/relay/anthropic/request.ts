import type Anthropic from "@anthropic-ai/sdk";
import type { ModelId, ThinkingOptions } from "@shared/types";
import { buildHistory, type HistoryMessage } from "./history";
import { MAX_TOKENS, modelParams } from "./thinking-config";
import { SYSTEM_PROMPT } from "./system-prompt";

export interface RequestInput {
  model: ModelId;
  thinking: ThinkingOptions;
  messages: readonly HistoryMessage[];
  userId?: string;
  cacheTail?: boolean;
}

export type StreamParams = Parameters<Anthropic["beta"]["messages"]["stream"]>[0];

/** The one request builder (D11, D13): the providers and the cache test share it. */
export function buildRequest(input: RequestInput): StreamParams {
  const params = modelParams(input.model, input.thinking);
  const request: StreamParams = {
    model: input.model,
    max_tokens: MAX_TOKENS,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: buildHistory(input.messages, { cacheTail: input.cacheTail }),
    betas: params.betas,
  };
  if (params.thinking) request.thinking = params.thinking;
  if (params.output_config) request.output_config = params.output_config;
  if (params.fallbacks) request.fallbacks = params.fallbacks;
  if (input.userId) request.metadata = { user_id: input.userId };
  return request;
}
