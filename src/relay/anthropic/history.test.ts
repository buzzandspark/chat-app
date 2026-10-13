import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { EFFORTS, MODEL_IDS } from "@shared/models";
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

  it("with cacheTail also marks the final assistant message's last text, so forks share one entry", () => {
    const history = buildHistory(
      [
        { role: "user", content: [text("a")], status: "done" },
        { role: "assistant", content: [thinking("t"), text("b")], status: "done" },
        { role: "user", content: [text("c")], status: "done" },
      ],
      { cacheTail: true },
    );
    const first = history[0]!.content as Anthropic.Beta.BetaTextBlockParam[];
    const assistant = history[1]!.content as Anthropic.Beta.BetaTextBlockParam[];
    const last = history[2]!.content as Anthropic.Beta.BetaTextBlockParam[];
    expect(first[0]!.cache_control).toBeUndefined();
    expect(assistant[1]!.cache_control).toEqual({ type: "ephemeral" });
    expect(last[0]!.cache_control).toEqual({ type: "ephemeral" });
    const request = buildRequest({ model: "claude-sonnet-5-5", thinking: { effort: "low" }, messages: [], cacheTail: true });
    expect(request.messages).toEqual([]);
  });

  it("builds the full request with per-model betas, fallbacks, and binding", () => {
    const messages: HistoryMessage[] = [{ role: "user", content: [text("hi")], status: "done" }];
    const sonnet = buildRequest({ model: "claude-sonnet-5-5", thinking: { effort: "low" }, messages });
    expect(sonnet.betas).toEqual(["server-side-fallback-2026-07-01", "thinking-binding-controls-2026-08-01"]);
    expect(sonnet.fallbacks).toBe("default");
    expect(sonnet.thinking).toEqual({
      type: "adaptive",
      display: "summarized",
      block_binding: { prefix_mismatch_behavior: "drop_block" },
    });
    expect(sonnet.output_config).toEqual({ effort: "low" });
    expect(Array.isArray(sonnet.system) && sonnet.system[0]?.cache_control).toEqual({ type: "ephemeral" });

    for (const model of MODEL_IDS) {
      for (const effort of EFFORTS) expect(buildRequest({ model, thinking: { effort }, messages }).output_config).toEqual({ effort });
    }

    // Haiku 5.5 thinks adaptively with effort like the others, binds its thinking blocks, and has no server-side fallback.
    const haiku = buildRequest({ model: "claude-haiku-5-5", thinking: { effort: "high" }, messages });
    expect(haiku.betas).toEqual(["thinking-binding-controls-2026-08-01"]);
    expect(haiku.fallbacks).toBeUndefined();
    expect(haiku.thinking).toEqual({ type: "adaptive", display: "summarized", block_binding: { prefix_mismatch_behavior: "drop_block" } });
    expect(haiku.output_config).toEqual({ effort: "high" });
    const haikuPlain = buildRequest({ model: "claude-haiku-5-5", thinking: { effort: "low" }, messages });
    expect(haikuPlain.output_config).toEqual({ effort: "low" });
    expect(haikuPlain.max_tokens).toBe(16_000);
    expect(buildRequest({ model: "claude-haiku-5-5", thinking: { effort: "low" }, messages, maxTokens: 8192 }).max_tokens).toBe(8192);
  });
});
