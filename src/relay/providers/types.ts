import type { ModelId, ThinkingOptions } from "@shared/types";
import type { HistoryMessage } from "../anthropic/history";
import type { NormalizableEvent } from "../anthropic/parse-stream";

export interface ProviderRequest {
  model: ModelId;
  thinking: ThinkingOptions;
  messages: readonly HistoryMessage[];
  userId?: string;
  /** Scenario name; providers that do not know it ignore it. */
  scenario?: string;
  /** A fork's first request also caches the parent's final reply. */
  cacheTail?: boolean;
  maxTokens?: number;
}

export interface ProviderStreamOptions {
  signal: AbortSignal;
}

/** Every output source yields raw Anthropic stream events, so nothing downstream knows which. */
export interface Provider {
  readonly name: "anthropic" | "replay" | "scripted" | "recording";
  stream(request: ProviderRequest, options: ProviderStreamOptions): AsyncIterable<NormalizableEvent>;
  /** The request's exact prompt tokens; providers that spend nothing need not count. */
  countTokens?(request: ProviderRequest, options: ProviderStreamOptions): Promise<number>;
}

/** Only the live provider (and its recorder) spends money. Keyed by name so an orphan settled from its `generations.provider` column applies the same rule as `Engine.start`. */
export function isBillableProvider(name: string): boolean {
  return name === "anthropic" || name === "recording";
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
