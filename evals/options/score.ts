import { MAX_FORKS } from "@shared/forks";
import { sampleCorrect, shown, titleOk, type CaseResult, type Metrics, type RunFile } from "@shared/evals";
import { percentile, ratio } from "./stats";

/** Every metric is over samples of the cases the guide settles; ambiguous cases are reported but not scored. */
export function summarize(cases: readonly CaseResult[]): Metrics {
  const scored = cases.filter((c) => !c.ambiguous);
  const samples = scored.flatMap((c) => c.samples.map((s) => ({ gold: c.gold, s })));
  const all = cases.flatMap((c) => c.samples);
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let negatives = 0;
  for (const { gold, s } of samples) {
    if (!gold.hasChoice) negatives++;
    if (shown(s) && gold.hasChoice) tp++;
    else if (shown(s)) fp++;
    else if (gold.hasChoice) fn++;
  }
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  const f1 = precision === null || recall === null || precision + recall === 0 ? null : (2 * precision * recall) / (precision + recall);

  const positives = samples.filter(({ gold }) => gold.hasChoice);
  const counted = samples.filter(({ s }) => shown(s) || (s.count ?? 0) >= 2);
  const judged = samples.flatMap(({ s }) => (s.judge ? [{ s, judge: s.judge }] : []));
  const verdicts = judged.flatMap(({ s, judge }) => judge.options.map((v, i) => ({ ...v, titleOk: titleOk(s.options[i]?.title ?? "") })));
  const titles = samples.flatMap(({ s }) => (shown(s) ? s.options.map((o) => titleOk(o.title)) : []));
  const multi = scored.filter((c) => c.samples.length > 1);

  return {
    cases: scored.length,
    positives: scored.filter((c) => c.gold.hasChoice).length,
    precision,
    recall,
    f1,
    falseButtonRate: ratio(fp, negatives),
    countExact: ratio(positives.filter(({ gold, s }) => sampleCorrect(gold, s)).length, positives.length),
    // The button's number comes from the streamed count, the sheet from the list.
    countAgrees: ratio(counted.filter(({ s }) => Math.min(s.count ?? 0, MAX_FORKS) === s.options.length).length, counted.length),
    coverage: ratio(judged.filter(({ judge }) => judge.coverage).length, judged.length),
    promptPass: ratio(verdicts.filter((v) => v.faithful && v.standalone && v.concrete && v.titleOk).length, verdicts.length),
    faithful: ratio(verdicts.filter((v) => v.faithful).length, verdicts.length),
    standalone: ratio(verdicts.filter((v) => v.standalone).length, verdicts.length),
    concrete: ratio(verdicts.filter((v) => v.concrete).length, verdicts.length),
    titleOk: ratio(titles.filter(Boolean).length, titles.length),
    parseFailRate: ratio(all.filter((s) => !s.parsed && !s.error).length, all.length),
    cutOffRate: ratio(all.filter((s) => s.stopReason === "max_tokens").length, all.length),
    errorRate: ratio(all.filter((s) => s.error).length, all.length),
    flipRate: multi.length === 0 ? null : ratio(multi.filter((c) => new Set(c.samples.map(shown)).size > 1).length, multi.length),
    costPer1k: all.length === 0 ? 0 : (all.reduce((sum, s) => sum + s.costUsd, 0) / all.length) * 1000,
    countMsP50: percentile(all.flatMap((s) => (s.countMs === null ? [] : [s.countMs])), 50),
    countMsP95: percentile(all.flatMap((s) => (s.countMs === null ? [] : [s.countMs])), 95),
    apiMsP50: percentile(all.flatMap((s) => (s.error ? [] : [s.apiMs])), 50),
    apiMsP95: percentile(all.flatMap((s) => (s.error ? [] : [s.apiMs])), 95),
  };
}

/** Samples scored correct (button and count) for each tag. */
export function byTag(cases: readonly CaseResult[]): RunFile["byTag"] {
  const out: RunFile["byTag"] = {};
  for (const c of cases) {
    if (c.ambiguous) continue;
    for (const tag of c.tags) {
      const entry = (out[tag] ??= { cases: 0, correct: 0 });
      entry.cases += c.samples.length;
      entry.correct += c.samples.filter((s) => sampleCorrect(c.gold, s)).length;
    }
  }
  return out;
}

export function bySplit(cases: readonly CaseResult[]): RunFile["bySplit"] {
  return { dev: summarize(cases.filter((c) => c.split === "dev")), test: summarize(cases.filter((c) => c.split === "test")) };
}
