import { describe, expect, it } from "vitest";
import type { CaseResult, Gold, SampleResult } from "@shared/evals";
import { byTag, summarize } from "./score";
import { cohensKappa, percentile } from "./stats";

const option = (title: string) => ({ title, prompt: `Let's go with ${title}: what's the plan?` });
const pass = { reasoning: "", faithful: true, standalone: true, concrete: true };

function sample(titles: string[], extra: Partial<SampleResult> = {}): SampleResult {
  return { options: titles.map(option), count: titles.length, parsed: true, stopReason: "end_turn", error: null, costUsd: 0.001, apiMs: 1000, countMs: 400, judge: null, ...extra };
}

function result(id: string, gold: Gold, samples: SampleResult[], extra: Partial<CaseResult> = {}): CaseResult {
  return { id, split: "dev", tags: [], ambiguous: false, gold, samples, ...extra };
}

const choice = (count: number): Gold => ({ hasChoice: true, count, titles: [] });
const none: Gold = { hasChoice: false, count: 0, titles: [] };

describe("eval scoring", () => {
  it("scores the button against the gold label, sample by sample", () => {
    const m = summarize([
      result("tp", choice(2), [sample(["A", "B"])]),
      result("fn", choice(3), [sample([])]),
      result("fp", none, [sample(["A", "B"])]),
      result("tn", none, [sample([])]),
      result("skipped", choice(2), [sample([])], { ambiguous: true }),
    ]);
    expect(m).toMatchObject({ cases: 4, positives: 2, precision: 0.5, recall: 0.5, f1: 0.5, falseButtonRate: 0.5, countExact: 0.5 });
  });

  it("counts against the first 10 alternatives, and checks the streamed count against the list", () => {
    const twelve = Array.from({ length: 10 }, (_, i) => `Name ${String.fromCharCode(65 + i)}`);
    const m = summarize([result("over", choice(12), [sample(twelve, { count: 12 })]), result("off", choice(3), [sample(["A", "B"], { count: 3 })])]);
    expect(m.countExact).toBe(0.5);
    expect(m.countAgrees).toBe(0.5);
  });

  it("passes a prompt only when every judge criterion and the title check pass", () => {
    const judged = sample(["Keep SQLite", "Option 2"], { judge: { options: [pass, pass], coverageReasoning: "", coverage: true } });
    const unfaithful = sample(["A", "B"], { judge: { options: [pass, { ...pass, faithful: false }], coverageReasoning: "", coverage: false } });
    const m = summarize([result("a", choice(2), [judged]), result("b", choice(2), [unfaithful])]);
    expect(m.promptPass).toBe(0.5);
    expect(m.faithful).toBe(0.75);
    expect(m.titleOk).toBe(0.75);
    expect(m.coverage).toBe(0.5);
  });

  it("reports flips, failures, cost and latency", () => {
    const m = summarize([
      result("flips", choice(2), [sample(["A", "B"]), sample([])]),
      result("steady", none, [sample([], { parsed: false }), sample([], { error: "overloaded", costUsd: 0.003 })]),
    ]);
    expect(m.flipRate).toBe(0.5);
    expect(m.parseFailRate).toBe(0.25);
    expect(m.errorRate).toBe(0.25);
    expect(m.costPer1k).toBeCloseTo(1.5);
    expect(m.countMsP50).toBe(400);
  });

  it("tallies correct samples per tag", () => {
    expect(byTag([result("a", none, [sample([]), sample(["A", "B"])], { tags: ["steps"] })])).toEqual({ steps: { cases: 2, correct: 1 } });
  });
});

describe("eval stats", () => {
  it("computes Cohen's kappa", () => {
    const a = [true, true, true, false, false, false, true, false, true, true];
    const b = [true, true, false, false, false, true, true, false, true, true];
    // Observed 0.8; both say yes 60% of the time, so chance is 0.36 + 0.16 = 0.52.
    expect(cohensKappa(a.map((x, i) => [x, b[i] ?? false] as const))).toBeCloseTo((0.8 - 0.52) / 0.48);
    expect(cohensKappa([[true, true]])).toBeNull();
  });

  it("takes nearest-rank percentiles", () => {
    expect(percentile([5, 1, 4, 2, 3], 50)).toBe(3);
    expect(percentile([5, 1, 4, 2, 3], 95)).toBe(5);
    expect(percentile([], 50)).toBeNull();
  });
});
