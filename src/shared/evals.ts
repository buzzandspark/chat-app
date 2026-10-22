import { z } from "zod";
import { MAX_FORKS } from "./forks";

/** The labels a person gave one reply: does it offer a choice, how many alternatives, and their names. */
export const Gold = z.object({
  hasChoice: z.boolean(),
  count: z.number().int().min(0),
  titles: z.array(z.string()),
});
export type Gold = z.infer<typeof Gold>;

export const OptionVerdict = z.object({
  reasoning: z.string(),
  faithful: z.boolean(),
  standalone: z.boolean(),
  concrete: z.boolean(),
});
export type OptionVerdict = z.infer<typeof OptionVerdict>;

/** Reasoning comes before each verdict so the judge decides after it explains. */
export const JudgeVerdict = z.object({
  options: z.array(OptionVerdict),
  coverageReasoning: z.string(),
  coverage: z.boolean(),
});
export type JudgeVerdict = z.infer<typeof JudgeVerdict>;

/** One detection of one case, as the app would have stored it, with its judge verdict. */
export const SampleResult = z.object({
  options: z.array(z.object({ title: z.string(), prompt: z.string() })),
  /** The streamed count the button shows; null when none arrived. */
  count: z.number().nullable(),
  parsed: z.boolean(),
  stopReason: z.string().nullable(),
  error: z.string().nullable(),
  costUsd: z.number(),
  apiMs: z.number(),
  countMs: z.number().nullable(),
  judge: JudgeVerdict.nullable(),
});
export type SampleResult = z.infer<typeof SampleResult>;

/** The reply itself stays in the dataset (evals/options/data/cases.jsonl), keyed by id. */
export const CaseResult = z.object({
  id: z.string(),
  split: z.enum(["dev", "test"]),
  tags: z.array(z.string()),
  ambiguous: z.boolean(),
  gold: Gold,
  samples: z.array(SampleResult),
});
export type CaseResult = z.infer<typeof CaseResult>;

const rate = z.number().nullable();
export const Metrics = z.object({
  cases: z.number(),
  positives: z.number(),
  precision: rate,
  recall: rate,
  f1: rate,
  falseButtonRate: rate,
  countExact: rate,
  countAgrees: rate,
  coverage: rate,
  promptPass: rate,
  faithful: rate,
  standalone: rate,
  concrete: rate,
  titleOk: rate,
  parseFailRate: rate,
  cutOffRate: rate,
  errorRate: rate,
  flipRate: rate,
  costPer1k: z.number(),
  countMsP50: rate,
  countMsP95: rate,
  apiMsP50: rate,
  apiMsP95: rate,
});
export type Metrics = z.infer<typeof Metrics>;
export const MetricKey = Metrics.keyof().exclude(["cases", "positives"]);
export type MetricKey = z.infer<typeof MetricKey>;

export const LOWER_IS_BETTER: ReadonlySet<MetricKey> = new Set([
  "falseButtonRate",
  "parseFailRate",
  "cutOffRate",
  "errorRate",
  "flipRate",
  "costPer1k",
  "countMsP50",
  "countMsP95",
  "apiMsP50",
  "apiMsP95",
]);

export const RunConfig = z.object({
  name: z.string(),
  model: z.string(),
  effort: z.string(),
  thinking: z.string(),
  hash: z.string(),
});
export type RunConfig = z.infer<typeof RunConfig>;

export const RunFile = z.object({
  id: z.string(),
  createdAt: z.string(),
  /** A production run measures the detect config the app ships; an experiment measures a variant. */
  kind: z.enum(["production", "experiment"]),
  note: z.string(),
  /** The run this one is compared with on its page. */
  baseline: z.string().nullable(),
  config: RunConfig,
  datasetHash: z.string(),
  judgeModel: z.string(),
  /** Changes with the judge's rubric; prompt-quality numbers compare only within one. */
  judgeVersion: z.string(),
  samples: z.number(),
  costUsd: z.object({ detect: z.number(), judge: z.number() }),
  summary: Metrics,
  bySplit: z.record(z.enum(["dev", "test"]), Metrics),
  byTag: z.record(z.string(), z.object({ cases: z.number(), correct: z.number() })),
  cases: z.array(CaseResult),
});
export type RunFile = z.infer<typeof RunFile>;

const GENERIC_TITLE = /^(option|choice|alternative)\s*\d+$/i;

/** The schema asks for at most four words, never "Option 1". */
export function titleOk(title: string): boolean {
  return title.split(/\s+/).filter(Boolean).length <= 4 && !GENERIC_TITLE.test(title.trim());
}

/** The app shows the Explore button for two or more options. */
export function shown(sample: Pick<SampleResult, "options">): boolean {
  return sample.options.length >= 2;
}

/** The right button, and for a choice the right number of options (the app keeps the first MAX_FORKS). */
export function sampleCorrect(gold: Gold, sample: SampleResult): boolean {
  if (shown(sample) !== gold.hasChoice) return false;
  return !gold.hasChoice || sample.options.length === Math.min(gold.count, MAX_FORKS);
}

const Agreement = z.object({
  items: z.number(),
  agreement: z.number().nullable(),
  kappa: z.number().nullable(),
  /** Of the items a person failed, the share the judge passed. */
  missedFailures: z.number().nullable(),
  /** Of the items a person passed, the share the judge failed. */
  falseAlarms: z.number().nullable(),
});

/** How often the judge agrees with people, per criterion, on the split it was tuned on and the one held out. */
export const Calibration = z.object({
  createdAt: z.string(),
  judgeModel: z.string(),
  judgeVersion: z.string(),
  labelers: z.array(z.string()),
  criteria: z.record(z.enum(["faithful", "standalone", "concrete", "coverage"]), z.object({ dev: Agreement, test: Agreement })),
});
export type Calibration = z.infer<typeof Calibration>;
