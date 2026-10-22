import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { Gold, RunFile } from "@shared/evals";

// Scripts run from the repo root (pnpm evals…), like the app's other tsx scripts.
export const OPTIONS_DIR = path.resolve("evals/options");
export const DATA_DIR = path.join(OPTIONS_DIR, "data");
export const CASES_PATH = path.join(DATA_DIR, "cases.jsonl");
export const JUDGE_LABELS_PATH = path.join(DATA_DIR, "judge-labels.jsonl");
export const RUNS_DIR = path.resolve("evals/runs");
export const CALIBRATION_PATH = path.resolve("evals/calibration.json");

export const Case = z.object({
  id: z.string(),
  source: z.enum(["local", "synthetic", "handwritten"]),
  split: z.enum(["dev", "test"]),
  tags: z.array(z.string()),
  /** The seed question a synthetic reply answered; null for local replies, whose users' messages stay private. The detector never sees it. */
  question: z.string().nullable(),
  reply: z.string(),
  gold: Gold,
  /** Left out of the metrics: the labeling guide doesn't settle it. */
  ambiguous: z.boolean(),
  /** A person has checked the gold label (drafts come from a model). */
  reviewed: z.boolean(),
  notes: z.string().optional(),
});
export type Case = z.infer<typeof Case>;

/** A person's verdicts on one answer, for checking the judge (pnpm evals:calibrate). */
export const JudgeLabel = z.object({
  id: z.string(),
  caseId: z.string(),
  /** The config whose answer this is. */
  from: z.string(),
  options: z.array(z.object({ title: z.string(), prompt: z.string() })),
  human: z
    .object({
      options: z.array(z.object({ faithful: z.boolean(), standalone: z.boolean(), concrete: z.boolean() })),
      coverage: z.boolean(),
    })
    .nullable(),
  labeler: z.string().nullable(),
});
export type JudgeLabel = z.infer<typeof JudgeLabel>;

export function sha256(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

export function readJsonl<T extends z.ZodType>(file: string, schema: T): z.infer<T>[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line, i) => {
      const result = schema.safeParse(JSON.parse(line));
      if (!result.success) throw new Error(`${path.basename(file)}:${i + 1}: ${result.error.message}`);
      return result.data;
    });
}

export function writeJsonl(file: string, rows: readonly unknown[]): void {
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

export function loadCases(): Case[] {
  return readJsonl(CASES_PATH, Case);
}

/** A third of the cases, chosen by id, are held out from prompt tuning. */
export function splitOf(id: string): "dev" | "test" {
  return parseInt(sha256(id).slice(0, 8), 16) % 3 === 0 ? "test" : "dev";
}

/** Committed runs, oldest first. */
export function loadRuns(): RunFile[] {
  if (!fs.existsSync(RUNS_DIR)) return [];
  return fs
    .readdirSync(RUNS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => RunFile.parse(JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), "utf8"))))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** A source file's text, so an edit to code that shapes an answer changes the hashes that key it. */
export function sourceOf(file: string): string {
  return fs.readFileSync(path.resolve(file), "utf8").replaceAll("\r\n", "\n");
}

/** Changes when anything a metric reads changes, so a committed run can be checked against the data. */
export function datasetHash(cases: readonly Case[]): string {
  return sha256(cases.map((c) => [c.id, c.split, c.tags, c.reply, c.gold, c.ambiguous])).slice(0, 12);
}
