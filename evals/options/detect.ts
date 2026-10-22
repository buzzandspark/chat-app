import type Anthropic from "@anthropic-ai/sdk";
import { costOf } from "@relay/anthropic/pricing";
import { LiveOptionsMessenger, OptionsCallError, type DetectConfig } from "@relay/options/messenger";
import type { SampleResult } from "@shared/evals";

export type Detection = Omit<SampleResult, "judge">;

/** One detection through the app's own messenger, so the prompt, schema, parsing and clamps are what production runs. */
export async function detect(client: Anthropic, config: DetectConfig, reply: string): Promise<Detection> {
  const started = performance.now();
  let count: number | null = null;
  let countMs: number | null = null;
  const onProgress = (p: { count?: number }) => {
    if (p.count === undefined || count !== null) return;
    count = p.count;
    countMs = Math.round(performance.now() - started);
  };
  try {
    const result = await new LiveOptionsMessenger(client, config).detect(reply, onProgress);
    if (!result.trace || !result.usage) throw new Error("A live detection always has a trace and usage");
    const { response, stopReason, apiMs } = result.trace;
    return {
      options: result.options,
      count,
      parsed: typeof response === "object" && response !== null,
      stopReason,
      error: null,
      costUsd: costOf(config.model, result.usage),
      apiMs,
      countMs,
    };
  } catch (err) {
    if (!(err instanceof OptionsCallError)) throw err;
    const ms = Math.round(performance.now() - started);
    return { options: [], count, parsed: false, stopReason: null, error: String(err.cause), costUsd: costOf(config.model, err.usage), apiMs: ms, countMs };
  }
}
