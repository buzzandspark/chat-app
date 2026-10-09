import Anthropic from "@anthropic-ai/sdk";
import { buildRequest } from "../anthropic/request";
import type { NormalizableEvent } from "../anthropic/parse-stream";
import type { Provider, ProviderRequest, ProviderStreamOptions } from "./types";

export class AnthropicProvider implements Provider {
  readonly name = "anthropic" as const;
  private client: Anthropic;

  constructor(client?: Anthropic) {
    // maxRetries 0: the relay owns retry policy and the client's reconnect
    // loop; a silent SDK retry would skew the latency breakdown (D20).
    this.client = client ?? new Anthropic({ maxRetries: 0, timeout: 10 * 60 * 1000 });
  }

  async *stream(request: ProviderRequest, { signal }: ProviderStreamOptions): AsyncIterable<NormalizableEvent> {
    const params = buildRequest({
      model: request.model,
      thinking: request.thinking,
      messages: request.messages,
      userId: request.userId,
      cacheTail: request.cacheTail,
    });
    const stream = this.client.beta.messages.stream(params, { signal });
    for await (const event of stream) {
      yield event;
    }
  }
}
