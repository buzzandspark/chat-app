import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { RunFile } from "@shared/evals";
import { loadRuns } from "./cases";
import { summarize } from "./score";

// check.ts reads gate.json, runs, cases and the hashed sources relative to its cwd, so each test runs it in a copy.
const ROOT = process.cwd();
const COPIED = ["evals/options/data/cases.jsonl", "src/relay/options/messenger.ts", "src/relay/options/schema.ts", "evals/options/detect.ts"];
const gate = z.object({ baseline: z.string(), tolerances: z.object({ f1: z.number(), falseButtonRate: z.number() }).loose() }).loose().parse(JSON.parse(fs.readFileSync(path.join(ROOT, "evals/options/gate.json"), "utf8")));
const latestRun = loadRuns().filter((r) => r.kind === "production").at(-1);
const dirs: string[] = [];

// The baseline is a copy of the latest production run under its own id, so the tests don't depend on which run gate.json pins.
function fixture(edit: { baseline?: (r: RunFile) => void; latest?: (r: RunFile) => void; gateBaseline?: string; runs?: RunFile[] } = {}) {
  if (!latestRun) throw new Error("fixture needs a committed production run");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evals-check-"));
  dirs.push(dir);
  for (const file of COPIED) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, file), path.join(dir, file));
  }
  fs.writeFileSync(path.join(dir, "evals/options/gate.json"), JSON.stringify({ ...gate, baseline: edit.gateBaseline ?? "fixture-baseline" }));
  fs.mkdirSync(path.join(dir, "evals/runs"));
  const baseline = { ...structuredClone(latestRun), id: "fixture-baseline", createdAt: "2000-01-01T00:00:00.000Z" };
  const latest = structuredClone(latestRun);
  edit.baseline?.(baseline);
  edit.latest?.(latest);
  for (const run of edit.runs ?? [baseline, latest]) fs.writeFileSync(path.join(dir, "evals/runs", `${run.id}.json`), JSON.stringify(run));
  return dir;
}

function check(dir: string) {
  const result = spawnSync(path.join(ROOT, "node_modules/.bin/tsx"), [path.join(ROOT, "evals/options/check.ts")], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, TSX_TSCONFIG_PATH: path.join(ROOT, "tsconfig.json") },
  });
  return { status: result.status, out: result.stdout + result.stderr };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("pnpm evals:check", { timeout: 30_000 }, () => {
  it("passes the committed runs", () => {
    expect(check(fixture())).toMatchObject({ status: 0, out: expect.stringContaining("✓ evals pass") });
  });

  it("fails a metric that worsened past its tolerance, in either direction", () => {
    const { status, out } = check(fixture({ baseline: (r) => Object.assign(r.summary, { f1: (r.summary.f1 ?? 0) + gate.tolerances.f1 + 0.01, falseButtonRate: (r.summary.falseButtonRate ?? 0) - gate.tolerances.falseButtonRate - 0.01 }) }));
    expect(status).toBe(1);
    expect(out).toMatch(/✗ f1 went from [\d.]+ to [\d.]+, worse by more than the [\d.]+ gate\.json allows/);
    expect(out).toMatch(/✗ falseButtonRate went from -?[\d.]+ to [\d.]+, worse by more than the [\d.]+ gate\.json allows/);
    expect(out).not.toMatch(/✗ countExact/);
  });

  it("fails a metric the latest run can no longer measure", () => {
    const unscored = (r: RunFile) => {
      r.cases.forEach((c) => (c.ambiguous = true));
      r.summary = summarize(r.cases);
    };
    const { status, out } = check(fixture({ latest: unscored }));
    expect(status).toBe(1);
    expect(out).toMatch(/✗ f1 was 0\.\d{3} and can no longer be measured/);
    expect(out).not.toContain("summary doesn't match");
  });

  it("fails a run measured on other code or other data", () => {
    const dir = fixture();
    fs.appendFileSync(path.join(dir, "src/relay/options/messenger.ts"), "\n// edited\n");
    fs.appendFileSync(path.join(dir, "evals/options/data/cases.jsonl"), fs.readFileSync(path.join(dir, "evals/options/data/cases.jsonl"), "utf8").split("\n")[0] + "\n");
    const { status, out } = check(dir);
    expect(status).toBe(1);
    expect(out).toMatch(/measured detect config \w+, but the code now sends \w+/);
    expect(out).toMatch(/ran on dataset \w+, but cases\.jsonl is now \w+/);
  });

  it("fails a summary that doesn't follow from the run's own cases", () => {
    const { status, out } = check(fixture({ latest: (r) => (r.summary.f1 = 0.99) }));
    expect(status).toBe(1);
    expect(out).toContain("summary doesn't match its own outputs");
  });

  it("fails a missing baseline or a missing production run", () => {
    expect(check(fixture({ gateBaseline: "2026-01-01-production-000000" })).out).toContain("gate.json's baseline 2026-01-01-production-000000 isn't a production run");
    expect(check(fixture({ runs: [] }))).toMatchObject({ status: 1, out: expect.stringContaining("No production run in evals/runs") });
  });
});
