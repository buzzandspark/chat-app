// Review in the terminal. `cases` walks the gold labels nobody has reviewed; `judge` asks for verdicts on the answers picked by `pnpm evals:calibrate sample`.
// Usage: pnpm evals:label cases | judge
import readline from "node:readline/promises";
import { CASES_PATH, JUDGE_LABELS_PATH, JudgeLabel, loadCases, readJsonl, writeJsonl, type Case } from "./cases";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const LABELER = process.env.EVALS_LABELER ?? "human";

function show(c: Pick<Case, "id" | "question" | "reply">): void {
  console.log(`\n${"═".repeat(80)}\n${c.id}${c.question ? `\nAsked: ${c.question}` : ""}\n${"─".repeat(80)}\n${c.reply}\n${"─".repeat(80)}`);
}

type Review = { kind: "accept" | "none" | "ambiguous" | "skip" | "quit" } | { kind: "choice"; count: number; titles: string[] };
const COMMANDS = new Map<string, Review>([["", { kind: "accept" }], ["n", { kind: "none" }], ["a", { kind: "ambiguous" }], ["s", { kind: "skip" }], ["q", { kind: "quit" }]]);

/** Asks again until the answer is a listed command, so a typo never marks a case reviewed. */
async function review(): Promise<Review> {
  for (;;) {
    const answer = (await rl.question("[enter] accept · n no choice · c <count> <title; title; …> · a ambiguous · s skip · q quit > ")).trim();
    const command = COMMANDS.get(answer);
    if (command) return command;
    const choice = /^c\s+(\d+)\s+(.+)$/.exec(answer);
    const titles = (choice?.[2] ?? "").split(";").map((t) => t.trim()).filter(Boolean);
    if (choice && titles.length > 0) return { kind: "choice", count: Number(choice[1]), titles };
    console.log(`Didn't understand "${answer}".`);
  }
}

async function reviewCases(): Promise<void> {
  const cases = loadCases();
  const todo = cases.filter((c) => !c.reviewed);
  console.log(`${todo.length} cases to review. See evals/options/GUIDE.md.`);
  for (const c of todo) {
    show(c);
    console.log(`Draft: ${c.gold.hasChoice ? `choice of ${c.gold.count}: ${c.gold.titles.join(" · ")}` : "no choice"}${c.ambiguous ? " (ambiguous)" : ""}  tags: ${c.tags.join(", ")}`);
    if (c.notes) console.log(c.notes);
    const answer = await review();
    if (answer.kind === "quit") break;
    if (answer.kind === "skip") continue;
    if (answer.kind === "none") c.gold = { hasChoice: false, count: 0, titles: [] };
    if (answer.kind === "choice") c.gold = { hasChoice: true, count: answer.count, titles: answer.titles };
    if (answer.kind !== "accept") c.ambiguous = answer.kind === "ambiguous";
    c.reviewed = true;
    writeJsonl(CASES_PATH, cases);
  }
}

async function yes(question: string): Promise<boolean> {
  for (;;) {
    const answer = (await rl.question(`${question} [y/n] `)).trim().toLowerCase();
    if (answer === "y" || answer === "n") return answer === "y";
  }
}

async function labelJudge(): Promise<void> {
  const cases = new Map(loadCases().map((c) => [c.id, c]));
  const labels = readJsonl(JUDGE_LABELS_PATH, JudgeLabel);
  const todo = labels.filter((l) => !l.human || l.labeler?.endsWith("(provisional)"));
  console.log(`${todo.length} answers to label. Criteria are in evals/options/judge.ts.`);
  for (const label of todo) {
    const c = cases.get(label.caseId);
    if (!c) continue;
    show(c);
    console.log(`Reference: ${c.gold.titles.join(" · ")}`);
    const options: NonNullable<JudgeLabel["human"]>["options"] = [];
    for (const [i, o] of label.options.entries()) {
      console.log(`\n${i + 1}. ${o.title}\n   ${o.prompt}`);
      options.push({
        faithful: await yes("   faithful (adds nothing the reply doesn't say)?"),
        standalone: await yes("   standalone (names its alternative, no reliance on the others)?"),
        concrete: await yes("   concrete (asks for something specific)?"),
      });
    }
    label.human = { options, coverage: await yes("\nCoverage: the items match the reference one to one?") };
    label.labeler = LABELER;
    writeJsonl(JUDGE_LABELS_PATH, labels);
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === "cases") await reviewCases();
  else if (mode === "judge") await labelJudge();
  else throw new Error("Usage: pnpm evals:label cases | judge");
  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
