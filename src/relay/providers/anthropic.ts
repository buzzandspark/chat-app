import Anthropic from "@anthropic-ai/sdk";
import { buildRequest } from "../anthropic/request";
import type { NormalizableEvent } from "../anthropic/parse-stream";
import type { Provider, ProviderRequest, ProviderStreamOptions } from "./types";

export class AnthropicProvider implements Provider {
  readonly name = "anthropic" as const;
  private client: Anthropic;

  constructor(client?: Anthropic) {
    // maxRetries 0: the relay owns retry policy and the client's reconnect
    // loop; a silent SDK retry would skew the latency breakdown.
    this.client = client ?? new Anthropic({ maxRetries: 0, timeout: 10 * 60 * 1000 });
  }

  async *stream(request: ProviderRequest, { signal }: ProviderStreamOptions): AsyncIterable<NormalizableEvent> {
    const stream = this.client.beta.messages.stream(params(request), { signal });
    for await (const event of stream) {
      yield event;
    }
  }

  async countTokens(request: ProviderRequest, { signal }: ProviderStreamOptions): Promise<number> {
    // Only the fields that shape the prompt: the endpoint refuses `fallbacks`.
    const { model, system, messages, thinking, output_config, betas } = params(request);
    const result = await this.client.beta.messages.countTokens({ model, system, messages, thinking, output_config, betas }, { signal });
    return result.input_tokens;
  }
}

function params(request: ProviderRequest) {
  return buildRequest({
    model: request.model,
    thinking: request.thinking,
    messages: request.messages,
    userId: request.userId,
    cacheTail: request.cacheTail,
    maxTokens: request.maxTokens,
  });
}
