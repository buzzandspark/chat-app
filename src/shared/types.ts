import type { ModelId } from "./models";

export type { ModelId };

export type UserRole = "admin" | "user";

/** generations.status (D2, D4, D5). */
export type GenerationStatus = "running" | "done" | "stopped" | "interrupted" | "error";

/** messages.status for assistant messages. User messages are always `done`. */
export type MessageStatus =
  | "done"
  | "streaming"
  | "stopped"
  | "interrupted"
  | "error"
  | "refused";

export type InterruptedReason = "shutdown" | "crash" | "upstream" | "engine_error" | "scenario";

export type StopReason =
  | "end_turn"
  | "max_tokens"
  | "stop_sequence"
  | "tool_use"
  | "pause_turn"
  | "refusal"
  | "compaction"
  | "model_context_window_exceeded";

export interface RefusalInfo {
  category: string | null;
  explanation: string | null;
}

// D20: server stamps on the server clock, client stamps on the client clock; intervals are derived
// on the side that owns both endpoints, never across machines.
export interface Timings {
  server?: {
    received: number;
    upstreamFirstToken?: number;
    firstRelayed?: number;
    done?: number;
    /** True when `iterations` shows a declined attempt before output (safety fallback). */
    declinedAttempt?: boolean;
  };
  client?: {
    sent: number;
    firstByte?: number;
    firstPaint?: number;
    done?: number;
  };
}

export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  estimated: boolean;
}

export interface ThinkingOptions {
  /** "Think harder" (D11): effort high on Sonnet/Opus, budgeted thinking on Haiku. */
  harder: boolean;
}

export const ERROR_KINDS = [
  "rate_limited",
  "overloaded",
  "api_error",
  "auth",
  "session",
  "forbidden",
  "quota_exceeded",
  "context_full",
  "bad_request",
  "network",
  "offline",
  /** Our own 503: the server is draining for a restart; the reply can be retried in a moment. */
  "unavailable",
  /** The server knew this generation and no longer does: its chat was deleted. */
  "gone",
  "unknown",
] as const;

/** Longest user message the route accepts; the composer counts against it. */
export const MAX_MESSAGE_CHARS = 32_000;
export type ErrorKind = (typeof ERROR_KINDS)[number];

export interface RelayError {
  kind: ErrorKind;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
  status?: number;
}
