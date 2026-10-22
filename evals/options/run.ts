// Runs one detect config over the dataset, judges the answers, and writes evals/runs/<id>.json.
// Usage: pnpm evals [--config production] [--samples 3] [--note "…"] [--baseline <run id>] [--concurrency 8]
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { SampleResult, shown, type CaseResult, type RunFile } from "@shared/evals";
import { cached } from "./cache";
import { RUNS_DIR, datasetHash, loadCases, loadRuns } from "./cases";
import { configByName, describeConfig } from "./configs";
import { detect } from "./detect";
import { JUDGE_MODEL, JUDGE_VERSION, judgeCached } from "./judge";
import { flag, pool } from "./pool";
import { byTag, bySplit, summarize } from "./score";

const DetectionSchema = SampleResult.omit({ judge: true });

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const name = flag(args, "config") ?? "production";
  const samples = Number(flag(args, "samples") ?? 3);
  const config = configByName(name);
  const described = describeConfig(name);
  const cases = loadCases();
  const client = new Anthropic({ maxRetries: 6, timeout: 120_000 });
  const tally = { hits: 0, spent: 0, judge: 0, judgeErrors: 0 };

  const jobs = cases.flatMap((c) => Array.from({ length: samples }, (_, sample) => ({ c, sample })));
  const results = await pool(jobs, Number(flag(args, "concurrency") ?? 8), async ({ c, sample }): Promise<SampleResult> => {
    // Breaks and API errors aren't cached, so a rerun retries them.
    const detection = await cached("detect", { hash: described.hash, reply: c.reply, sample }, DetectionSchema, () => detect(client, config, c.reply), (d) => d.error === null).catch(
      (err: unknown) => ({ value: { options: [], count: null, parsed: false, stopReason: null, error: String(err), costUsd: 0, apiMs: 0, countMs: null }, hit: false }),
    );
    if (detection.hit) tally.hits++;
    else tally.spent += detection.value.costUsd;
    // Only answers that show the button on a reply with a choice: elsewhere detection already scored them.
    // A failed judge call leaves the sample unjudged rather than losing the run; a rerun retries it.
    const judged =
      !c.ambiguous && c.gold.hasChoice && shown(detection.value)
        ? await judgeCached(client, c.reply, c.gold, detection.value.options).catch((err: unknown) => {
            tally.judgeErrors++;
            console.error(`\njudge failed on ${c.id}: ${String(err)}`);
            return null;
          })
        : null;
    if (judged) {
      tally.judge += judged.value.costUsd;
      if (!judged.hit) tally.spent += judged.value.costUsd;
    }
    process.stdout.write(detection.hit ? "." : "+");
    return { ...detection.value, judge: judged?.value.verdict ?? null };
  });

  const caseResults: CaseResult[] = cases.map((c, i) => ({
    id: c.id,
    split: c.split,
    tags: c.tags,
    ambiguous: c.ambiguous,
    gold: c.gold,
    samples: results.slice(i * samples, (i + 1) * samples),
  }));
  const createdAt = new Date().toISOString();
  const id = `${createdAt.slice(0, 10)}-${createdAt.slice(11, 19).replaceAll(":", "")}-${name}-${described.hash.slice(0, 6)}`;
  const previous = loadRuns().filter((r) => r.kind === "production").at(-1);
  const run: RunFile = {
    id,
    createdAt,
    kind: name === "production" ? "production" : "experiment",
    note: flag(args, "note") ?? "",
    baseline: flag(args, "baseline") ?? previous?.id ?? null,
    config: described,
    datasetHash: datasetHash(cases),
    judgeModel: JUDGE_MODEL,
    judgeVersion: JUDGE_VERSION,
    samples,
    costUsd: { detect: results.reduce((sum, r) => sum + r.costUsd, 0), judge: tally.judge },
    summary: summarize(caseResults),
    bySplit: bySplit(caseResults),
    byTag: byTag(caseResults),
    cases: caseResults,
  };
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RUNS_DIR, `${id}.json`), JSON.stringify(run) + "\n", { flag: "wx" });

  const m = run.summary;
  const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
  console.log(`\n\n${id}: ${jobs.length} detections, ${tally.hits} from cache, $${tally.spent.toFixed(2)} spent now ($${(run.costUsd.detect + run.costUsd.judge).toFixed(2)} uncached)`);
  if (tally.judgeErrors > 0) console.log(`${tally.judgeErrors} answers went unjudged after judge errors; rerun to retry them.`);
  const { dev, test } = run.bySplit;
  console.log(`dev: F1 ${pct(dev.f1)}  false buttons ${pct(dev.falseButtonRate)}  count exact ${pct(dev.countExact)}  prompts pass ${pct(dev.promptPass)}  coverage ${pct(dev.coverage)}`);
  console.log(`held out (don't tune on these): F1 ${pct(test.f1)}  false buttons ${pct(test.falseButtonRate)}`);
  console.log(`flips ${pct(m.flipRate)}  parse fails ${pct(m.parseFailRate)}  errors ${pct(m.errorRate)}  $${m.costPer1k.toFixed(2)}/1k  count p95 ${m.countMsP95}ms`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
