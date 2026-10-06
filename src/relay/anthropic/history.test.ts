import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { assistantParams, buildHistory, type HistoryMessage } from "./history";
import { buildRequest } from "./request";

const text = (t: string): Anthropic.Beta.BetaTextBlock => ({ type: "text", text: t, citations: null });
const thinking = (t: string, sig = "sig"): Anthropic.Beta.BetaThinkingBlock => ({ type: "thinking", thinking: t, signature: sig });
const fallback = (): Anthropic.Beta.BetaFallbackBlock => ({
  type: "fallback",
  from: { model: "claude-sonnet-5-5" },
  to: { model: "claude-opus-4-8" },
  trigger: { type: "refusal", category: "cyber" },
});

describe("history", () => {
  it("omits thinking and tool_use before the final fallback block but keeps text", () => {
    const params = assistantParams([
      thinking("early"),
      text("before"),
      { type: "tool_use", id: "t1", name: "x", input: {} },
      fallback(),
      thinking("late"),
      text("after"),
    ]);
    expect(params.map((p) => p.type)).toEqual(["text", "fallback", "thinking", "text"]);
  });

  it("echoes thinking blocks unchanged when there is no fallback", () => {
    const params = assistantParams([thinking("t", "abc"), text("x")]);
    expect(params[0]).toEqual({ type: "thinking", thinking: "t", signature: "abc" });
  });

  it("drops unsigned thinking from interrupted streams", () => {
    const params = assistantParams([thinking("partial", ""), text("x")]);
    expect(params.map((p) => p.type)).toEqual(["text"]);
  });

  it("excludes refused and errored assistant messages and empty ones", () => {
    const messages: HistoryMessage[] = [
      { role: "user", content: [text("q1")], status: "done" },
      { role: "assistant", content: [text("discarded")], status: "refused" },
      { role: "user", content: [text("q2")], status: "done" },
      { role: "assistant", content: [], status: "error" },
      { role: "user", content: [text("q3")], status: "done" },
      { role: "assistant", content: [text("kept   ")], status: "interrupted" },
      { role: "user", content: [text("q4")], status: "done" },
    ];
    const history = buildHistory(messages);
    expect(history.map((m) => m.role)).toEqual(["user", "user", "user", "assistant", "user"]);
    const kept = history[3]!.content as Anthropic.Beta.BetaTextBlockParam[];
    expect(kept[0]!.text).toBe("kept");
  });

  it("places the moving cache breakpoint on the newest user message only", () => {
    const history = buildHistory([
      { role: "user", content: [text("a")], status: "done" },
      { role: "assistant", content: [text("b")], status: "done" },
      { role: "user", content: [text("c")], status: "done" },
    ]);
    const first = history[0]!.content as Anthropic.Beta.BetaTextBlockParam[];
    const last = history[2]!.content as Anthropic.Beta.BetaTextBlockParam[];
    expect(first[0]!.cache_control).toBeUndefined();
    expect(last[0]!.cache_control).toEqual({ type: "ephemeral" });
  });

  it("builds the full request with per-model betas, fallbacks, and binding", () => {
    const messages: HistoryMessage[] = [{ role: "user", content: [text("hi")], status: "done" }];
    const sonnet = buildRequest({ model: "claude-sonnet-5-5", thinking: { harder: false }, messages });
    expect(sonnet.betas).toEqual(["server-side-fallback-2026-07-01", "thinking-binding-controls-2026-08-01"]);
    expect(sonnet.fallbacks).toBe("default");
    expect(sonnet.thinking).toEqual({
      type: "adaptive",
      display: "summarized",
      block_binding: { prefix_mismatch_behavior: "drop_block" },
    });
    expect(sonnet.output_config).toEqual({ effort: "low" });
    expect(Array.isArray(sonnet.system) && sonnet.system[0]?.cache_control).toEqual({ type: "ephemeral" });

    const harder = buildRequest({ model: "claude-opus-5-5", thinking: { harder: true }, messages });
    expect(harder.output_config).toEqual({ effort: "high" });

    const haiku = buildRequest({ model: "claude-haiku-4-5", thinking: { harder: true }, messages });
    expect(haiku.betas).toEqual([]);
    expect(haiku.fallbacks).toBeUndefined();
    expect(haiku.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
    const haikuPlain = buildRequest({ model: "claude-haiku-4-5", thinking: { harder: false }, messages });
    expect(haikuPlain.thinking).toBeUndefined();
  });
});
