// The CI gate, with no API calls. The newest production run must have measured the detect config and dataset in this checkout,
// its summary must follow from its own outputs, and no gated metric may fall past its tolerance from the baseline run pinned in gate.json.
// Usage: pnpm evals:check
import { isDeepStrictEqual } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { LOWER_IS_BETTER, Metrics } from "@shared/evals";
import { OPTIONS_DIR, datasetHash, loadCases, loadRuns } from "./cases";
import { describeConfig } from "./configs";
import { summarize } from "./score";

const MetricName = Metrics.keyof().exclude(["cases", "positives"]);
const Gate = z.object({ note: z.string(), baseline: z.string(), tolerances: z.partialRecord(MetricName, z.number()) });

function main(): string[] {
  const gate = Gate.parse(JSON.parse(fs.readFileSync(path.join(OPTIONS_DIR, "gate.json"), "utf8")));
  const production = loadRuns().filter((r) => r.kind === "production");
  const latest = production.at(-1);
  if (!latest) return ["No production run in evals/runs. Run `pnpm evals` and commit the run."];

  const failures: string[] = [];
  const config = describeConfig("production");
  if (latest.config.hash !== config.hash) failures.push(`${latest.id} measured detect config ${latest.config.hash}, but the code now sends ${config.hash}. Run \`pnpm evals\` and commit the run.`);
  const dataset = datasetHash(loadCases());
  if (latest.datasetHash !== dataset) failures.push(`${latest.id} ran on dataset ${latest.datasetHash}, but cases.jsonl is now ${dataset}. Run \`pnpm evals\` and commit the run.`);
  if (!isDeepStrictEqual(summarize(latest.cases), latest.summary)) failures.push(`${latest.id}'s summary doesn't match its own outputs.`);

  // Pinned rather than the run before, so committing another worse run can't move the bar.
  const previous = production.find((r) => r.id === gate.baseline);
  if (!previous) return [...failures, `gate.json's baseline ${gate.baseline} isn't a production run in evals/runs.`];
  console.log(`${latest.id} against ${previous.id}`);
  if (previous === latest) return failures;
  if (previous.datasetHash !== latest.datasetHash) console.log("The dataset changed between these runs, so the comparison below mixes data and model changes.");
  if (previous.judgeVersion !== latest.judgeVersion) console.log("The judge changed between these runs, so judged metrics compare different graders.");
  for (const key of MetricName.options) {
    const tolerance = gate.tolerances[key];
    const before = previous.summary[key];
    const after = latest.summary[key];
    if (tolerance === undefined || before === null) continue;
    if (after === null) {
      failures.push(`${key} was ${before.toFixed(3)} and can no longer be measured.`);
      continue;
    }
    const drop = LOWER_IS_BETTER.has(key) ? after - before : before - after;
    const verdict = drop > tolerance ? "REGRESSED" : "ok";
    console.log(`  ${key.padEnd(16)} ${before.toFixed(3)} → ${after.toFixed(3)}  (allowed worsening ${tolerance})  ${verdict}`);
    if (drop > tolerance) failures.push(`${key} went from ${before.toFixed(3)} to ${after.toFixed(3)}, worse by more than the ${tolerance} gate.json allows.`);
  }
  return failures;
}

const failures = main();
for (const f of failures) console.error(`✗ ${f}`);
if (failures.length > 0) process.exit(1);
console.log("✓ evals pass");
