import { describe, expect, it } from "vitest";
import { costOf, priceIterations, ratesFor, summarize } from "./pricing";

describe("pricing", () => {
  it("prices two iterations at their own models' rates", () => {
    const rows = priceIterations(
      [
        { type: "message", model: "claude-sonnet-5-5", input_tokens: 1000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
        { type: "fallback_message", model: "claude-opus-4-8", input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
      ],
      "claude-sonnet-5-5",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.costUsd).toBeCloseTo(1000 * 2 / 1e6, 9);
    expect(rows[1]!.costUsd).toBeCloseTo((1000 * 5 + 1000 * 25) / 1e6, 9);
    const total = summarize(rows);
    expect(total.costUsd).toBeCloseTo(rows[0]!.costUsd + rows[1]!.costUsd, 9);
    expect(total.inputTokens).toBe(2000);
  });

  it("matches dated snapshots by prefix and falls back for unknown ids", () => {
    expect(ratesFor("claude-opus-4-8-20260301")).toEqual(ratesFor("claude-opus-4-8"));
    expect(ratesFor("claude-mystery-9")).toEqual(ratesFor("claude-opus-5-5"));
  });

  it("charges cache reads and writes at their own rates", () => {
    const cost = costOf("claude-haiku-4-5", { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1e6, cacheWriteTokens: 1e6 });
    expect(cost).toBeCloseTo(0.1 + 1.25, 9);
  });

  it("uses the default model when an iteration has no model", () => {
    const rows = priceIterations(
      [{ type: "message", model: null as unknown as "claude-opus-5-5", input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null }],
      "claude-haiku-4-5",
    );
    expect(rows[0]!.model).toBe("claude-haiku-4-5");
  });

  it("prices Claude Haiku 5.5 at its long-context tier once the prompt passes 100k tokens", () => {
    const short = costOf("claude-haiku-5-5", { inputTokens: 50_000, outputTokens: 1_000, cacheReadTokens: 0, cacheWriteTokens: 0 });
    expect(short).toBeCloseTo((50_000 * 0.1 + 1_000 * 0.5) / 1_000_000, 9);
    const long = costOf("claude-haiku-5-5", { inputTokens: 90_000, outputTokens: 1_000, cacheReadTokens: 20_000, cacheWriteTokens: 0 });
    expect(long).toBeCloseTo((90_000 * 0.5 + 1_000 * 2.5 + 20_000 * 0.05) / 1_000_000, 9);
    expect(ratesFor("claude-haiku-5-5").output).toBe(0.5);
    expect(ratesFor("claude-haiku-5-5", 200_000).output).toBe(2.5);
  });
});
