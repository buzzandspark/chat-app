import { seedOutputTps } from "./anthropic/pricing";

// Rolling output tokens/s per model, seeded, for estimating billed output when only elapsed time is known.
export class TpsStats {
  private ema = new Map<string, number>();
  constructor(private alpha = 0.2) {}

  record(model: string, outputTokens: number, elapsedMs: number): void {
    if (outputTokens <= 0 || elapsedMs < 250) return;
    const sample = outputTokens / (elapsedMs / 1000);
    const prev = this.ema.get(model) ?? seedOutputTps(model);
    this.ema.set(model, prev + this.alpha * (sample - prev));
  }

  get(model: string): number {
    return this.ema.get(model) ?? seedOutputTps(model);
  }

  estimateOutputTokens(model: string, elapsedMs: number): number {
    return Math.max(0, Math.round(this.get(model) * (elapsedMs / 1000)));
  }
}
