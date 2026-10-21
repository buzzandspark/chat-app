// Checks the judge against people. `sample` picks answers from the latest production and degraded runs into data/judge-labels.jsonl;
// people label them with `pnpm evals:label judge`; the default command grades the labeled ones and writes evals/calibration.json.
// Usage: pnpm evals:calibrate [sample [--n 40]]
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { shown, type Calibration } from "@shared/evals";
import { JUDGE_LABELS_PATH, JudgeLabel, loadCases, loadRuns, readJsonl, sha256, splitOf, writeJsonl } from "./cases";
import { JUDGE_MODEL, JUDGE_VERSION, judgeCached } from "./judge";
import { flag, pool } from "./pool";
import { cohensKappa, ratio } from "./stats";

const CALIBRATION_PATH = path.resolve("evals/calibration.json");
const CRITERIA = ["faithful", "standalone", "concrete", "coverage"] as const;

/** Half from what the app ships, half from deliberately poor answers, so there are failures for the judge to catch. */
function sample(n: number): void {
  const existing = readJsonl(JUDGE_LABELS_PATH, JudgeLabel);
  const have = new Set(existing.map((l) => l.id));
  const runs = loadRuns();
  const picked: JudgeLabel[] = [];
  for (const from of ["production", "degraded"]) {
    const run = runs.filter((r) => r.config.name === from).at(-1);
    if (!run) throw new Error(`No ${from} run yet: pnpm evals --config ${from}`);
    const answers = run.cases
      .filter((c) => !c.ambiguous && c.gold.hasChoice)
      .flatMap((c) => c.samples.flatMap((s, i) => (shown(s) ? [{ id: `${c.id}:${from}:${i}`, caseId: c.id, options: s.options }] : [])))
      .filter((a) => !have.has(a.id))
      // A stable shuffle, one answer per case.
      .sort((a, b) => sha256(a.id).localeCompare(sha256(b.id)))
      .filter((a, i, all) => all.findIndex((b) => b.caseId === a.caseId) === i)
      .slice(0, Math.ceil(n / 2));
    picked.push(...answers.map((a) => ({ ...a, from, human: null, labeler: null })));
  }
  writeJsonl(JUDGE_LABELS_PATH, [...existing, ...picked]);
  console.log(`${picked.length} answers to label in ${path.relative(process.cwd(), JUDGE_LABELS_PATH)}: pnpm evals:label judge`);
}

async function grade(): Promise<void> {
  const cases = new Map(loadCases().map((c) => [c.id, c]));
  const labeled = readJsonl(JUDGE_LABELS_PATH, JudgeLabel).filter((l) => l.human && cases.has(l.caseId));
  const client = new Anthropic({ maxRetries: 6, timeout: 120_000 });
  const pairs = await pool(labeled, 8, async (label) => {
    const c = cases.get(label.caseId);
    if (!c || !label.human) return [];
    const { value } = await judgeCached(client, c.reply, c.gold, label.options);
    const verdict = value.verdict;
    if (!verdict) return [];
    const split = splitOf(label.caseId);
    const human = label.human;
    return [
      ...human.options.flatMap((h, i) => {
        const j = verdict.options[i];
        return j ? (["faithful", "standalone", "concrete"] as const).map((k) => ({ split, criterion: k, pair: [h[k], j[k]] as const })) : [];
      }),
      { split, criterion: "coverage" as const, pair: [human.coverage, verdict.coverage] as const },
    ];
  });
  const flat = pairs.flat();
  const agreement = (criterion: (typeof CRITERIA)[number], split: "dev" | "test") => {
    const ps = flat.filter((p) => p.criterion === criterion && p.split === split).map((p) => p.pair);
    return {
      items: ps.length,
      agreement: ratio(ps.filter(([h, j]) => h === j).length, ps.length),
      kappa: cohensKappa(ps),
      missedFailures: ratio(ps.filter(([h, j]) => !h && j).length, ps.filter(([h]) => !h).length),
      falseAlarms: ratio(ps.filter(([h, j]) => h && !j).length, ps.filter(([h]) => h).length),
    };
  };
  const bySplit = (criterion: (typeof CRITERIA)[number]) => ({ dev: agreement(criterion, "dev"), test: agreement(criterion, "test") });
  const calibration: Calibration = {
    createdAt: new Date().toISOString(),
    judgeModel: JUDGE_MODEL,
    judgeVersion: JUDGE_VERSION,
    labelers: [...new Set(labeled.flatMap((l) => (l.labeler ? [l.labeler] : [])))],
    criteria: {
      faithful: bySplit("faithful"),
      standalone: bySplit("standalone"),
      concrete: bySplit("concrete"),
      coverage: bySplit("coverage"),
    },
  };
  fs.writeFileSync(CALIBRATION_PATH, JSON.stringify(calibration, null, 2) + "\n");
  const fmt = (v: number | null) => (v === null ? " n/a" : v.toFixed(2));
  console.log(`${labeled.length} labeled answers, judged by ${JUDGE_MODEL}\n${"criterion".padEnd(12)}split  items  agree  kappa  missed  false alarms`);
  for (const k of CRITERIA) {
    for (const split of ["dev", "test"] as const) {
      const a = calibration.criteria[k][split];
      console.log(`${k.padEnd(12)}${split.padEnd(7)}${String(a.items).padStart(5)}  ${fmt(a.agreement)}   ${fmt(a.kappa)}   ${fmt(a.missedFailures)}    ${fmt(a.falseAlarms)}`);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "sample") sample(Number(flag(args, "n") ?? 40));
  else await grade();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
