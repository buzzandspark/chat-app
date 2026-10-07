import type { ModelId, ThinkingOptions } from "@shared/types";
import type { HistoryMessage } from "../anthropic/history";
import type { NormalizableEvent } from "../anthropic/parse-stream";

export interface ProviderRequest {
  model: ModelId;
  thinking: ThinkingOptions;
  messages: readonly HistoryMessage[];
  userId?: string;
  /** D24 scenario name; providers that do not know it ignore it. */
  scenario?: string;
}

export interface ProviderStreamOptions {
  signal: AbortSignal;
}

/** Every output source yields raw Anthropic stream events, so nothing downstream knows which (D24). */
export interface Provider {
  readonly name: "anthropic" | "replay" | "scripted" | "recording";
  stream(request: ProviderRequest, options: ProviderStreamOptions): AsyncIterable<NormalizableEvent>;
}

/** A thrown provider error expressed as data, as the SDK would throw it. */
export interface FixtureThrow {
  status: number;
  type: string;
  message: string;
  retryAfter?: number;
}

// One jsonl fixture line; t is ms since the first line. A raw API event, a control instruction
// (disconnect ends the stream as a dropped upstream would), or an error to throw.
export type FixtureLine =
  | { t: number; event: NormalizableEvent }
  | { t: number; control: "disconnect" }
  | { t: number; throw: FixtureThrow };
