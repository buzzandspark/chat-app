import "server-only";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { Calibration, type RunFile } from "@shared/evals";
import { RUNS_DIR, loadRuns } from "../../evals/options/cases";

// The committed results of evals/options, read at build time: the /evals pages are static.
const CASES_PATH = path.join(process.cwd(), "evals/options/data/cases.jsonl");
const CALIBRATION_PATH = path.join(process.cwd(), "evals/calibration.json");

const Reply = z.object({ id: z.string(), question: z.string().nullable(), reply: z.string() });
export type Reply = z.infer<typeof Reply>;

// Parsed once per change to the runs folder (runs are only ever added), not once per page.
let loaded: { mtimeMs: number; runs: RunFile[]; byId: Map<string, RunFile> } | null = null;

function runs(): NonNullable<typeof loaded> {
  const mtimeMs = fs.existsSync(RUNS_DIR) ? fs.statSync(RUNS_DIR).mtimeMs : 0;
  if (loaded?.mtimeMs !== mtimeMs) {
    const all = loadRuns();
    loaded = { mtimeMs, runs: all, byId: new Map(all.map((r) => [r.id, r])) };
  }
  return loaded;
}

/** Oldest first. */
export function listRuns(): RunFile[] {
  return runs().runs;
}

export function getRun(id: string): RunFile | null {
  return runs().byId.get(id) ?? null;
}

/** The dataset's replies by case id; runs store only the ids. */
export function listReplies(): Map<string, Reply> {
  if (!fs.existsSync(CASES_PATH)) return new Map();
  const lines = fs.readFileSync(CASES_PATH, "utf8").split("\n").filter((l) => l.trim());
  return new Map(lines.map((l) => Reply.parse(JSON.parse(l))).map((r) => [r.id, r]));
}

export function getCalibration(): Calibration | null {
  if (!fs.existsSync(CALIBRATION_PATH)) return null;
  return Calibration.parse(JSON.parse(fs.readFileSync(CALIBRATION_PATH, "utf8")));
}
