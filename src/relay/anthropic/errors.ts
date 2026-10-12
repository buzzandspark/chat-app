import Anthropic from "@anthropic-ai/sdk";
import type { RelayError } from "@shared/types";

/** Shared with the replay provider's classifier (engine.ts) so a fixture and the live API agree on what "context full" reads as. */
export const CONTEXT_FULL_RE =
  /prompt is too long|context window|too many tokens|exceeds? the (?:maximum )?context|maximum context length|input length and `?max_tokens`? exceed/i;

function retryAfterMs(headers: unknown): number | undefined {
  let value: string | null | undefined;
  if (headers instanceof Headers) value = headers.get("retry-after");
  else if (headers && typeof headers === "object") {
    const h = headers as Record<string, unknown>;
    const raw = h["retry-after"] ?? h["Retry-After"];
    if (typeof raw === "string") value = raw;
  }
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}

export function isAbortError(err: unknown): boolean {
  if (err instanceof Anthropic.APIUserAbortError) return true;
  return typeof err === "object" && err !== null && (err as { name?: string }).name === "AbortError";
}

/** SDK typed errors to the relay's error vocabulary. */
export function toRelayError(err: unknown): RelayError {
  if (err instanceof Anthropic.RateLimitError) {
    return {
      kind: "rate_limited",
      message: "Rate limited by the model provider",
      retryable: true,
      retryAfterMs: retryAfterMs(err.headers) ?? 15_000,
      status: 429,
    };
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return {
      kind: "auth",
      message: "The server's API key was rejected",
      retryable: false,
      status: err.status,
    };
  }
  if (err instanceof Anthropic.BadRequestError) {
    if (CONTEXT_FULL_RE.test(err.message)) {
      return { kind: "context_full", message: "This chat is too long to continue", retryable: false, status: 400 };
    }
    return { kind: "bad_request", message: err.message, retryable: false, status: 400 };
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return { kind: "network", message: "The model provider timed out", retryable: true };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { kind: "network", message: "Lost the connection to the model provider", retryable: true };
  }
  if (err instanceof Anthropic.APIError) {
    // No status: the SDK threw an SSE `event: error` inside a 200 stream, `err.type` the inner type. Classify by it as a fixture's error event is,
    // or a mid-stream rate_limit_error lands as a non-retryable api_error. Non-JSON data arrives as a bare string, which makeMessage would quote.
    if (err.status === undefined) {
      const body = err.error as { error?: { type?: string; message?: string } } | string | undefined;
      const type = err.type ?? undefined;
      const inner = typeof body === "string" ? { type, message: body } : body?.error;
      return errorEventToRelayError(inner ?? { type, message: err.message }, undefined, err.headers);
    }
    const status = err.status;
    const type = (err as { type?: string }).type;
    if (status === 413) {
      return { kind: "context_full", message: "This chat is too long to continue", retryable: false, status };
    }
    if (status === 529 || type === "overloaded_error") {
      return {
        kind: "overloaded",
        message: "The model provider is overloaded",
        retryable: true,
        retryAfterMs: retryAfterMs(err.headers) ?? 10_000,
        status,
      };
    }
    if (status !== undefined && status >= 500) {
      return { kind: "api_error", message: "The model provider had an error", retryable: true, status };
    }
    return { kind: "api_error", message: err.message, retryable: false, status };
  }
  if (err instanceof Error) {
    if (/ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|terminated/i.test(err.message)) {
      return { kind: "network", message: "Lost the connection to the model provider", retryable: true };
    }
    return { kind: "unknown", message: err.message, retryable: false };
  }
  return { kind: "unknown", message: String(err), retryable: false };
}

/**
 * Mid-stream `error` events: carried as data (replay fixtures, raw SSE) or thrown by the SDK with no status (toRelayError).
 * `headers` are the stream's response headers; a 200 rarely carries retry-after, but honour it when it does.
 */
export function errorEventToRelayError(error: { type?: string; message?: string }, status?: number, headers?: unknown): RelayError {
  switch (error.type) {
    case "overloaded_error":
      return { kind: "overloaded", message: error.message ?? "Overloaded", retryable: true, retryAfterMs: retryAfterMs(headers) ?? 10_000, status: status ?? 529 };
    case "rate_limit_error":
      return { kind: "rate_limited", message: error.message ?? "Rate limited", retryable: true, retryAfterMs: retryAfterMs(headers) ?? 15_000, status: status ?? 429 };
    case "request_too_large":
      // toRelayError's 413 branch, so the same overflow reads the same before and after the first byte.
      return { kind: "context_full", message: "This chat is too long to continue", retryable: false, status: status ?? 413 };
    case "authentication_error":
    case "permission_error":
      return { kind: "auth", message: error.message ?? "Unauthorized", retryable: false, status };
    case "invalid_request_error":
      if (CONTEXT_FULL_RE.test(error.message ?? "")) {
        return { kind: "context_full", message: "This chat is too long to continue", retryable: false, status: 400 };
      }
      return { kind: "bad_request", message: error.message ?? "Invalid request", retryable: false, status: 400 };
    case "api_error":
      return { kind: "api_error", message: error.message ?? "API error", retryable: true, status: status ?? 500 };
    default:
      return { kind: "unknown", message: error.message ?? "Unknown error", retryable: false, status };
  }
}
