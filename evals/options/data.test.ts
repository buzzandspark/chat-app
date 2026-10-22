import { describe, expect, it } from "vitest";
import { loadCases, splitOf } from "./cases";

describe("eval dataset", () => {
  const cases = loadCases();

  it("keeps each case on the split its id hashes to, so the held-out third stays held out", () => {
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    expect(cases.filter((c) => c.split !== splitOf(c.id)).map((c) => c.id)).toEqual([]);
  });

  it("publishes no local user's question", () => {
    expect(cases.filter((c) => c.source === "local" && c.question !== null).map((c) => c.id)).toEqual([]);
  });

  it("labels a choice with its titles and a non-choice with none", () => {
    const inconsistent = cases.filter(({ gold }) => (gold.hasChoice ? gold.count < 2 || gold.titles.length !== gold.count : gold.count !== 0 || gold.titles.length > 0));
    expect(inconsistent.map((c) => c.id)).toEqual([]);
  });
});
