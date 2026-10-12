import fs from "node:fs";
import path from "node:path";
import type { NormalizableEvent } from "../anthropic/parse-stream";
import type { Provider, ProviderRequest, ProviderStreamOptions } from "./types";

/** Wraps a provider and records each stream as a replayable jsonl fixture. */
export class RecordingProvider implements Provider {
  readonly name = "recording" as const;
  constructor(
    private inner: Provider,
    private dir: string,
  ) {}

  async *stream(request: ProviderRequest, options: ProviderStreamOptions): AsyncIterable<NormalizableEvent> {
    fs.mkdirSync(this.dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(this.dir, `${stamp}-${request.model}.jsonl`);
    const out = fs.createWriteStream(file, { flags: "a" });
    let started: number | null = null;
    try {
      for await (const event of this.inner.stream(request, options)) {
        const now = Date.now();
        started ??= now;
        out.write(`${JSON.stringify({ t: now - started, event })}\n`);
        yield event;
      }
    } finally {
      out.end();
    }
  }
}
