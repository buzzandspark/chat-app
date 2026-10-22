import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { Calibration } from "@shared/evals";
import { CALIBRATION_PATH, JUDGE_LABELS_PATH, JudgeLabel, loadCases, readJsonl, splitOf } from "./cases";

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

  // pnpm evals:calibrate pairs every human verdict with the judge's, so the published counts follow from the labels.
  it("publishes a calibration that matches the judge labels, with no κ where people failed nothing", () => {
    const calibration = Calibration.parse(JSON.parse(fs.readFileSync(CALIBRATION_PATH, "utf8")));
    const ids = new Set(cases.map((c) => c.id));
    const labeled = readJsonl(JUDGE_LABELS_PATH, JudgeLabel).flatMap((l) => (l.human && ids.has(l.caseId) ? [{ labeler: l.labeler, human: l.human, split: splitOf(l.caseId) }] : []));
    expect(calibration.labelers.toSorted()).toEqual([...new Set(labeled.flatMap((l) => (l.labeler ? [l.labeler] : [])))].sort());
    for (const split of ["dev", "test"] as const) {
      const mine = labeled.filter((l) => l.split === split);
      for (const criterion of ["faithful", "standalone", "concrete", "coverage"] as const) {
        const human = criterion === "coverage" ? mine.map((l) => l.human.coverage) : mine.flatMap((l) => l.human.options.map((o) => o[criterion]));
        const published = calibration.criteria[criterion]?.[split];
        expect(published?.items, `${criterion} ${split}`).toBe(human.length);
        if (human.every(Boolean)) expect(published, `${criterion} ${split}`).toMatchObject({ kappa: null, missedFailures: null });
      }
    }
  });
});
