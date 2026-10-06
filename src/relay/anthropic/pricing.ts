import type { IterationUsage } from "@shared/blocks";
import type { UsageSummary } from "@shared/types";

/** USD per million tokens. Cache writes are 1.25x input on every model here. */
export interface Rates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

// Checked against the bundled Claude API reference on 2026-10-06.
const RATES: Record<string, Rates> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  // Fallback targets the API may route to (D11).
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
};

const FALLBACK_RATES: Rates = RATES["claude-opus-5-5"]!;

/** Exact id first, then the longest known prefix (dated snapshots), else Opus rates. */
export function ratesFor(model: string): Rates {
  const exact = RATES[model];
  if (exact) return exact;
  let best: Rates | null = null;
  let bestLen = 0;
  for (const [id, rates] of Object.entries(RATES)) {
    if (model.startsWith(id) && id.length > bestLen) {
      best = rates;
      bestLen = id.length;
    }
  }
  return best ?? FALLBACK_RATES;
}

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function costOf(model: string, tokens: TokenCounts): number {
  const r = ratesFor(model);
  return (
    (tokens.inputTokens * r.input +
      tokens.outputTokens * r.output +
      tokens.cacheReadTokens * r.cacheRead +
      tokens.cacheWriteTokens * r.cacheWrite) /
    1_000_000
  );
}

export interface UsageRow extends TokenCounts {
  model: string;
  iterationType: string;
  costUsd: number;
}

/**
 * D22: each iteration priced at its own model's rates. A declined attempt is a
 * `message` entry for the declined model; the serving hop is `fallback_message`.
 */
export function priceIterations(iterations: IterationUsage, defaultModel: string): UsageRow[] {
  const rows: UsageRow[] = [];
  for (const it of iterations) {
    if (it.type !== "message" && it.type !== "fallback_message") continue;
    const model = it.model ?? defaultModel;
    const tokens: TokenCounts = {
      inputTokens: it.input_tokens ?? 0,
      outputTokens: it.output_tokens ?? 0,
      cacheReadTokens: it.cache_read_input_tokens ?? 0,
      cacheWriteTokens: it.cache_creation_input_tokens ?? 0,
    };
    rows.push({ model, iterationType: it.type, costUsd: costOf(model, tokens), ...tokens });
  }
  return rows;
}

export function summarize(rows: UsageRow[], estimated = false): UsageSummary {
  const s: UsageSummary = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    estimated,
  };
  for (const r of rows) {
    s.inputTokens += r.inputTokens;
    s.outputTokens += r.outputTokens;
    s.cacheReadTokens += r.cacheReadTokens;
    s.cacheWriteTokens += r.cacheWriteTokens;
    s.costUsd += r.costUsd;
  }
  return s;
}

/**
 * Seeded output tokens-per-second per model, used to estimate the billed
 * output of a stopped or interrupted generation from elapsed streaming time
 * (D22). The engine keeps a rolling average from completed generations.
 */
export const SEED_OUTPUT_TPS: Record<string, number> = {
  "claude-sonnet-5-5": 80,
  "claude-opus-5-5": 50,
  "claude-haiku-4-5": 140,
};

export function seedOutputTps(model: string): number {
  return SEED_OUTPUT_TPS[model] ?? 60;
}
