import "server-only";
import fs from "node:fs";
import type { z } from "zod";
import { Calibration, type RunFile } from "@shared/evals";
import { CALIBRATION_PATH, CASES_PATH, Case, RUNS_DIR, loadRuns, readJsonl } from "@/evals/options/cases";

// The committed results of evals/options.

const Reply = Case.pick({ id: true, question: true, reply: true });
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
  return new Map(readJsonl(CASES_PATH, Reply).map((r) => [r.id, r]));
}

export function getCalibration(): Calibration | null {
  if (!fs.existsSync(CALIBRATION_PATH)) return null;
  return Calibration.parse(JSON.parse(fs.readFileSync(CALIBRATION_PATH, "utf8")));
}
