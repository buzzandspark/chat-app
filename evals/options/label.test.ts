import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Gold } from "@shared/evals";
import { Case, JudgeLabel, readJsonl } from "./cases";

// label.ts reads and writes the dataset relative to its cwd, so each test runs it in a temp dir and types one answer per prompt.
const ROOT = process.cwd();
const dirs: string[] = [];

const choice = (...titles: string[]): Gold => ({ hasChoice: true, count: titles.length, titles });
const none: Gold = { hasChoice: false, count: 0, titles: [] };
const draft = (id: string, gold: Gold, ambiguous = false): Case => ({ id, source: "handwritten", split: "dev", tags: [], question: null, reply: `Reply ${id}`, gold, ambiguous, reviewed: false });

function workspace(files: Record<string, readonly unknown[]>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evals-label-"));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, "evals/options/data"), { recursive: true });
  for (const [name, rows] of Object.entries(files)) fs.writeFileSync(path.join(dir, "evals/options/data", name), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return dir;
}

/** Writes the next answer each time label.ts prompts (`> ` for cases, `[y/n] ` for the judge), then closes stdin. */
function label(dir: string, mode: "cases" | "judge", answers: string[]) {
  const child = spawn(path.join(ROOT, "node_modules/.bin/tsx"), [path.join(ROOT, "evals/options/label.ts"), mode], {
    cwd: dir,
    env: { ...process.env, TSX_TSCONFIG_PATH: path.join(ROOT, "tsconfig.json"), EVALS_LABELER: "Test Labeler" },
  });
  let out = "";
  let prompts = 0;
  const prompt = mode === "cases" ? / > $/ : /\[y\/n\] $/;
  child.stdout.on("data", (chunk: Buffer) => {
    out += chunk.toString();
    if (!prompt.test(out)) return;
    const next = answers[prompts++];
    if (next === undefined) child.stdin.end();
    else child.stdin.write(next + "\n");
  });
  child.stderr.on("data", (chunk: Buffer) => (out += chunk.toString()));
  return new Promise<{ status: number | null; out: string }>((resolve) => child.on("close", (status) => resolve({ status, out })));
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("pnpm evals:label", { timeout: 30_000 }, () => {
  it("reviews cases key by key, re-asking on anything it doesn't understand", async () => {
    const dir = workspace({
      "cases.jsonl": [
        draft("keep-ambiguous", choice("A", "B"), true),
        draft("to-none", choice("A", "B"), true),
        draft("to-choice", none, true),
        draft("accepted", choice("A", "B"), true),
        draft("skipped", choice("A", "B")),
        draft("after-quit", choice("A", "B")),
      ],
    });
    const { status, out } = await label(dir, "cases", ["typo", "c 2", "a", "n", "c 2 Foo; Bar", "", "s", "q"]);
    expect(status).toBe(0);
    expect(out).toContain(`Didn't understand "typo"`);
    expect(out).toContain(`Didn't understand "c 2"`);
    const byId = new Map(readJsonl(path.join(dir, "evals/options/data/cases.jsonl"), Case).map((c) => [c.id, c]));
    expect(byId.get("keep-ambiguous")).toMatchObject({ gold: choice("A", "B"), ambiguous: true, reviewed: true });
    expect(byId.get("to-none")).toMatchObject({ gold: none, ambiguous: false, reviewed: true });
    expect(byId.get("to-choice")).toMatchObject({ gold: choice("Foo", "Bar"), ambiguous: false, reviewed: true });
    expect(byId.get("accepted")).toMatchObject({ gold: choice("A", "B"), ambiguous: true, reviewed: true });
    expect(byId.get("skipped")).toMatchObject({ reviewed: false });
    expect(byId.get("after-quit")).toMatchObject({ reviewed: false });
  });

  it("asks a person to relabel provisional judge labels and records EVALS_LABELER", async () => {
    const options = [{ title: "A", prompt: "Go with A" }];
    const human = { options: [{ faithful: true, standalone: true, concrete: true }], coverage: true };
    const row = (id: string, extra: Pick<JudgeLabel, "human" | "labeler">): JudgeLabel => ({ id, caseId: "c", from: "production", options, ...extra });
    const dir = workspace({
      "cases.jsonl": [draft("c", choice("A", "B"))],
      "judge-labels.jsonl": [row("provisional", { human, labeler: "claude-opus-5-5 (provisional)" }), row("unlabeled", { human: null, labeler: null }), row("done", { human, labeler: "Someone" })],
    });
    const { status, out } = await label(dir, "judge", ["n", "y", "y", "n", "y", "y", "y", "y"]);
    expect(status).toBe(0);
    expect(out).toContain("2 answers to label");
    const byId = new Map(readJsonl(path.join(dir, "evals/options/data/judge-labels.jsonl"), JudgeLabel).map((l) => [l.id, l]));
    expect(byId.get("provisional")).toMatchObject({ labeler: "Test Labeler", human: { options: [{ faithful: false, standalone: true, concrete: true }], coverage: false } });
    expect(byId.get("unlabeled")).toMatchObject({ labeler: "Test Labeler", human });
    expect(byId.get("done")).toMatchObject({ labeler: "Someone" });
  });
});
