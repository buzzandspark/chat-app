import type { Effort, ModelId } from "./models";

export type { Effort, ModelId };

/** A guest is an anonymous visitor: Haiku only, a small cost cap, its chats move to the account it signs in to. */
export type UserRole = "admin" | "user" | "guest";

/** generations.status. */
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

// Server stamps on the server clock, client stamps on the client clock; intervals are derived
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
  /** Sent as output_config.effort for every model. */
  effort: Effort;
}

type ErrorKind =
  | "rate_limited"
  | "overloaded"
  | "api_error"
  | "auth"
  | "session"
  | "forbidden"
  | "quota_exceeded"
  /** Spend is under the cap, but not by enough for a reply's input and full output. */
  | "quota_short"
  | "context_full"
  | "bad_request"
  | "network"
  | "offline"
  /** Our own 503: the server is draining for a restart; the reply can be retried in a moment. */
  | "unavailable"
  /** The server knew this generation and no longer does: its chat was deleted. */
  | "gone"
  /** An Edit or Regenerate whose turns the server could not replace now; nothing was added. */
  | "conflict"
  /** A guest's new work while an admin has blocked guests. */
  | "guests_blocked"
  | "unknown";

/** Password lengths sign-in accepts; the invite route and form hold a new password to the same. */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/** Longest user message the route accepts; the composer counts against it. */
export const MAX_MESSAGE_CHARS = 32_000;

export interface RelayError {
  kind: ErrorKind;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
  status?: number;
}
