import Anthropic, { type APIError } from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { errorEventToRelayError, toRelayError } from "./errors";

/** What core/streaming.js throws for an SSE `event: error` inside a 200 stream: no status, the whole body as `error`. */
function midStream(type: string, message: string, headers = new Headers()): APIError {
  const body = { type: "error", error: { type, message } };
  return new Anthropic.APIError(undefined, body, undefined, headers, type as APIError["type"]);
}

describe("toRelayError, mid-stream SDK errors", () => {
  it("rate_limit_error is rate_limited and retries after 15s, or retry-after when the stream sent one", () => {
    const e = midStream("rate_limit_error", "Number of request tokens has exceeded your per-minute rate limit");
    expect(toRelayError(e)).toEqual({
      kind: "rate_limited",
      message: "Number of request tokens has exceeded your per-minute rate limit",
      retryable: true,
      retryAfterMs: 15_000,
      status: 429,
    });
    const withHeader = midStream("rate_limit_error", "Rate limited", new Headers({ "retry-after": "7" }));
    expect(toRelayError(withHeader).retryAfterMs).toBe(7_000);
  });

  it("api_error is a retryable api_error", () => {
    expect(toRelayError(midStream("api_error", "Internal server error"))).toEqual({
      kind: "api_error",
      message: "Internal server error",
      retryable: true,
      status: 500,
    });
  });

  it("overloaded_error is overloaded with a 10s retry", () => {
    expect(toRelayError(midStream("overloaded_error", "Overloaded"))).toEqual({
      kind: "overloaded",
      message: "Overloaded",
      retryable: true,
      retryAfterMs: 10_000,
      status: 529,
    });
  });

  it("request_too_large and a context-length invalid_request_error are context_full", () => {
    expect(toRelayError(midStream("request_too_large", "Request exceeds the maximum allowed number of bytes"))).toMatchObject({
      kind: "context_full",
      retryable: false,
      status: 413,
    });
    expect(toRelayError(midStream("invalid_request_error", "prompt is too long: 1000421 tokens > 1000000 maximum"))).toMatchObject({
      kind: "context_full",
      retryable: false,
    });
  });

  it("an unknown type is unknown with the API's message, not the raw JSON body", () => {
    const r = toRelayError(midStream("teapot_error", "I'm a teapot"));
    expect(r).toMatchObject({ kind: "unknown", message: "I'm a teapot", retryable: false });
    expect(r.message).not.toContain("{");
  });

  it("a body that isn't JSON falls back to the SDK's message", () => {
    const e = new Anthropic.APIError(undefined, "upstream exploded", undefined, new Headers(), null);
    expect(toRelayError(e)).toMatchObject({ kind: "unknown", message: "upstream exploded", retryable: false });
  });

  it("agrees with the same event carried as data", () => {
    for (const type of ["rate_limit_error", "api_error", "overloaded_error", "request_too_large", "invalid_request_error"]) {
      const message = "prompt is too long: 2 > 1";
      expect(toRelayError(midStream(type, message))).toEqual(errorEventToRelayError({ type, message }));
    }
  });
});

describe("toRelayError, HTTP status errors", () => {
  it("a 500 before the stream starts is still a retryable api_error", () => {
    const e = Anthropic.APIError.generate(500, { type: "error", error: { type: "api_error", message: "boom" } }, undefined, new Headers());
    expect(toRelayError(e)).toMatchObject({ kind: "api_error", retryable: true, status: 500 });
  });

  it("a 413 is context_full", () => {
    const e = Anthropic.APIError.generate(413, { type: "error", error: { type: "request_too_large", message: "too big" } }, undefined, new Headers());
    expect(toRelayError(e)).toMatchObject({ kind: "context_full", retryable: false, status: 413 });
  });
});
