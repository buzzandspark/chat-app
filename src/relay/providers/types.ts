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

/**
 * D24: every source of model output is a Provider yielding raw Anthropic
 * stream events, so the engine, parser, and client never know whether the
 * tokens came from the API, a recorded fixture, or a script.
 */
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

/**
 * One line of a `*.jsonl` fixture: `t` is ms since the first line. Either a
 * raw API event, a control instruction (`disconnect` ends the stream as if the
 * upstream connection dropped), or an error to throw.
 */
export type FixtureLine =
  | { t: number; event: NormalizableEvent }
  | { t: number; control: "disconnect" }
  | { t: number; throw: FixtureThrow };
