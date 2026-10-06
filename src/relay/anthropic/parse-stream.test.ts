import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { toContentBlocks } from "./accumulate";
import {
  accumulatedText,
  createAccumulator,
  hadDeclinedAttempt,
  normalizeEvent,
  resolveServingModel,
  type NormalizableEvent,
} from "./parse-stream";
import { scriptToFixture, type Script } from "../providers/scripted";
import type { RelayEventBody } from "../events";

function run(events: NormalizableEvent[]) {
  const acc = createAccumulator();
  const out: RelayEventBody[] = [];
  for (const e of events) out.push(...normalizeEvent(e, acc));
  return { acc, out };
}

function eventsOf(script: Script): NormalizableEvent[] {
  return scriptToFixture(script).flatMap((l) => ("event" in l ? [l.event] : []));
}

const model = "claude-sonnet-5-5";

describe("normalizeEvent", () => {
  it("streams text and thinking with block boundaries", () => {
    const { acc, out } = run(
      eventsOf({ model, parts: [{ kind: "thinking", text: "plan it" }, { kind: "text", text: "hello world" }] }),
    );
    expect(out.map((e) => e.type)).toEqual([
      "message_start",
      "block_start",
      "thinking_delta",
      "block_stop",
      "block_start",
      "text_delta",
      "text_delta",
      "block_stop",
    ]);
    expect(accumulatedText(acc)).toBe("hello world");
    const blocks = toContentBlocks(acc);
    expect(blocks[0]).toMatchObject({ type: "thinking", thinking: "plan it" });
    expect((blocks[0] as Anthropic.Beta.BetaThinkingBlock).signature).not.toBe("");
    expect(blocks[1]).toMatchObject({ type: "text", text: "hello world" });
    expect(acc.stopReason).toBe("end_turn");
    expect(resolveServingModel(acc)).toBe(model);
  });

  it("pre-output fallback: invisible boundary, serving model from the block, declined attempt flagged", () => {
    const { acc, out } = run(
      eventsOf({
        model: "claude-opus-4-8",
        parts: [
          { kind: "fallback", from: model, to: "claude-opus-4-8", category: "cyber" },
          { kind: "text", text: "served by fallback" },
        ],
      }),
    );
    const boundary = out.find((e) => e.type === "fallback_boundary");
    expect(boundary).toMatchObject({ from: model, to: "claude-opus-4-8", category: "cyber", visible: false });
    expect(resolveServingModel(acc)).toBe("claude-opus-4-8");
    expect(hadDeclinedAttempt(acc)).toBe(true);
    const blocks = toContentBlocks(acc);
    expect(blocks[0]!.type).toBe("fallback");
    expect(blocks[1]).toMatchObject({ type: "text", text: "served by fallback" });
  });

  it("mid-stream fallback keeps the partial and marks a visible boundary", () => {
    const { acc, out } = run(
      eventsOf({
        model,
        parts: [
          { kind: "text", text: "before" },
          { kind: "fallback", from: model, to: "claude-opus-4-8", category: null },
          { kind: "text", text: " after" },
        ],
        iterations: [
          { type: "message", model, input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
          { type: "fallback_message", model: "claude-opus-4-8", input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
        ],
      }),
    );
    const boundary = out.find((e) => e.type === "fallback_boundary");
    expect(boundary).toMatchObject({ visible: true, to: "claude-opus-4-8" });
    expect(accumulatedText(acc)).toBe("before after");
    expect(hadDeclinedAttempt(acc)).toBe(false);
    expect(acc.usage.iterations).toHaveLength(2);
    expect(toContentBlocks(acc).map((b) => b.type)).toEqual(["text", "fallback", "text"]);
  });

  it("sticky-routed turn: no block, serving model from the fallback_message iteration", () => {
    const events = eventsOf({
      model: "claude-opus-4-8",
      parts: [{ kind: "text", text: "sticky" }],
      iterations: [
        { type: "fallback_message", model: "claude-opus-4-8", input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
      ],
    });
    const { acc, out } = run(events);
    expect(out.some((e) => e.type === "fallback_boundary")).toBe(false);
    expect(resolveServingModel(acc)).toBe("claude-opus-4-8");
    expect(hadDeclinedAttempt(acc)).toBe(false);
  });

  it("refusal with null category and explanation after partial text", () => {
    const { acc, out } = run(
      eventsOf({ model, parts: [{ kind: "text", text: "partial" }], stopReason: "refusal", stopDetails: { category: null, explanation: null } }),
    );
    const refusal = out.find((e) => e.type === "refusal");
    expect(refusal).toEqual({ type: "refusal", category: null, explanation: null, hadText: true });
    expect(acc.stopReason).toBe("refusal");
  });

  it("refusal before any output carries the category", () => {
    const { out } = run(eventsOf({ model, parts: [], stopReason: "refusal", stopDetails: { category: "bio", explanation: "nope" } }));
    expect(out.find((e) => e.type === "refusal")).toMatchObject({ category: "bio", explanation: "nope", hadText: false });
  });

  it("max_tokens is recorded as the stop reason", () => {
    const { acc } = run(eventsOf({ model, parts: [{ kind: "text", text: "cut" }], stopReason: "max_tokens" }));
    expect(acc.stopReason).toBe("max_tokens");
  });

  it("maps mid-stream error events", () => {
    const { out } = run([{ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }]);
    expect(out[0]).toMatchObject({ type: "error", error: { kind: "overloaded", retryable: true } });
    const { out: ctx } = run([{ type: "error", error: { type: "invalid_request_error", message: "prompt is too long: 1 > 0" } }]);
    expect(ctx[0]).toMatchObject({ type: "error", error: { kind: "context_full" } });
  });

  it("records input transformations and usage from message_start and message_delta", () => {
    const events = eventsOf({ model, parts: [{ kind: "text", text: "x" }], inputTokens: 42 });
    const start = events[0] as Anthropic.Beta.BetaRawMessageStartEvent;
    (start.message as unknown as { input_transformations: unknown[] }).input_transformations = [
      { type: "thinking_dropped", path: "messages.1.content.0", reason: "model_binding_mismatch" },
    ];
    const { acc, out } = run(events);
    expect(out[0]).toMatchObject({ type: "message_start", inputTokens: 42, inputTransformations: [{ reason: "model_binding_mismatch" }] });
    expect(acc.usage.inputTokens).toBe(42);
    expect(acc.usage.outputTokens).toBeGreaterThan(0);
  });

  it("ignores deltas for unknown block indices and unknown block types", () => {
    const { out } = run([
      { type: "content_block_delta", index: 9, delta: { type: "text_delta", text: "ghost" } },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "server_tool_use", id: "s", name: "web_search", input: {} } as unknown as Anthropic.Beta.BetaContentBlock,
      },
    ]);
    expect(out).toEqual([]);
  });
});
