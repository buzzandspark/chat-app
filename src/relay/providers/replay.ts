import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type { NormalizableEvent } from "../anthropic/parse-stream";
import type { FixtureLine, Provider, ProviderRequest, ProviderStreamOptions } from "./types";

export class ProviderStatusError extends Error {
  constructor(
    public status: number,
    public type: string,
    message: string,
    public retryAfter?: number,
  ) {
    super(message);
    this.name = "ProviderStatusError";
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function* readFixtureFile(file: string, signal?: AbortSignal): AsyncIterable<FixtureLine> {
  const rl = readline.createInterface({ input: fs.createReadStream(file, "utf8"), crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (signal?.aborted) return;
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      yield JSON.parse(trimmed) as FixtureLine;
    }
  } finally {
    rl.close();
  }
}

/**
 * Replays fixture lines with their original pacing scaled by `speed`
 * (1 = real time, 0 = no delays). Shared by the file-backed ReplayProvider
 * and the in-memory ScriptedProvider.
 */
export async function* replayLines(
  lines: AsyncIterable<FixtureLine> | Iterable<FixtureLine>,
  speed: number,
  signal: AbortSignal,
): AsyncIterable<NormalizableEvent> {
  const started = Date.now();
  for await (const line of lines) {
    if (speed > 0) await sleep(started + line.t / speed - Date.now(), signal);
    if (signal.aborted) return;
    if ("event" in line) {
      yield line.event;
    } else if ("control" in line) {
      if (line.control === "disconnect") return;
    } else {
      throw new ProviderStatusError(line.throw.status, line.throw.type, line.throw.message, line.throw.retryAfter);
    }
  }
}

export interface ReplayOptions {
  fixturesDir: string;
  /** Fixture path (without `.jsonl`) relative to `fixturesDir`, or a chooser per request. */
  fixture: string | ((request: ProviderRequest) => string);
  speed?: number;
}

/** D24: replays a recorded `*.jsonl` stream from disk. */
export class ReplayProvider implements Provider {
  readonly name = "replay" as const;
  constructor(private options: ReplayOptions) {}

  stream(request: ProviderRequest, { signal }: ProviderStreamOptions): AsyncIterable<NormalizableEvent> {
    const name = typeof this.options.fixture === "function" ? this.options.fixture(request) : this.options.fixture;
    const file = path.join(this.options.fixturesDir, `${name}.jsonl`);
    return replayLines(readFixtureFile(file, signal), this.options.speed ?? 1, signal);
  }
}
