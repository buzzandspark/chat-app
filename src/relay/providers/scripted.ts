import type Anthropic from "@anthropic-ai/sdk";
import type { NormalizableEvent } from "../anthropic/parse-stream";
import type { FixtureLine, FixtureThrow, Provider, ProviderRequest, ProviderStreamOptions } from "./types";
import { replayLines } from "./replay";

type ScriptPart =
  | { kind: "thinking"; text: string; chunk?: number; intervalMs?: number; signature?: string }
  | {
      kind: "text";
      text: string;
      chunk?: number;
      intervalMs?: number;
      jitterMs?: number;
      burstEvery?: number;
      burstPauseMs?: number;
    }
  | { kind: "fallback"; from: string; to: string; category: string | null }
  | { kind: "pause"; ms: number }
  /** End the stream here as if the connection to the provider dropped. */
  | { kind: "disconnect" }
  /** Emit an SSE-level error event and stop. */
  | { kind: "error"; error: { type: string; message: string }; status?: number };

export interface Script {
  model: string;
  /** Delay before `message_start`: simulated time to first token. */
  ttftMs?: number;
  inputTokens?: number;
  parts: ScriptPart[];
  stopReason?: Anthropic.Beta.BetaStopReason;
  stopDetails?: { category: string | null; explanation: string | null } | null;
  outputTokens?: number;
  iterations?: Anthropic.Beta.BetaUsage["iterations"];
  /** Throw this before any event, as the SDK would on a 429/529/5xx. */
  throwBefore?: FixtureThrow;
}

export type ScriptFactory = (request: ProviderRequest) => Script;

/** Deterministic PRNG so fixtures are reproducible for a given seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Script to fixture lines with synthetic timestamps, no sleeping. ScriptedProvider and the on-disk
// fixtures share this, so a scenario behaves identically from memory or disk (D24).
export function scriptToFixture(script: Script, seed = 1): FixtureLine[] {
  const rng = mulberry32(seed);
  const lines: FixtureLine[] = [];
  let t = 0;
  const push = (event: NormalizableEvent) => lines.push({ t: Math.round(t), event });

  if (script.throwBefore) {
    t += script.ttftMs ?? 200;
    lines.push({ t: Math.round(t), throw: script.throwBefore });
    return lines;
  }
  t += script.ttftMs ?? 300;
  const inputTokens = script.inputTokens ?? 800;
  push({ type: "message_start", message: messageStart(script.model, inputTokens, seed) });

  let index = 0;
  let outputChars = 0;
  for (const part of script.parts) {
    switch (part.kind) {
      case "pause":
        t += part.ms;
        break;
      case "disconnect":
        lines.push({ t: Math.round(t), control: "disconnect" });
        return lines;
      case "error":
        push({ type: "error", error: part.error, status: part.status });
        return lines;
      case "fallback":
        push({
          type: "content_block_start",
          index,
          content_block: {
            type: "fallback",
            from: { model: part.from },
            to: { model: part.to },
            trigger: { type: "refusal", category: part.category },
          } as Anthropic.Beta.BetaFallbackBlock,
        });
        push({ type: "content_block_stop", index });
        index++;
        break;
      case "thinking": {
        push({ type: "content_block_start", index, content_block: { type: "thinking", thinking: "", signature: "" } });
        const chunk = part.chunk ?? 12;
        for (let i = 0; i < part.text.length; i += chunk) {
          push({
            type: "content_block_delta",
            index,
            delta: { type: "thinking_delta", thinking: part.text.slice(i, i + chunk), estimated_tokens: null },
          });
          t += part.intervalMs ?? 30;
        }
        push({
          type: "content_block_delta",
          index,
          delta: { type: "signature_delta", signature: part.signature ?? `sig_${script.model}_${index}` },
        });
        push({ type: "content_block_stop", index });
        index++;
        break;
      }
      case "text": {
        push({ type: "content_block_start", index, content_block: { type: "text", text: "", citations: null } });
        const chunk = part.chunk ?? 6;
        let n = 0;
        for (let i = 0; i < part.text.length; i += chunk) {
          const text = part.text.slice(i, i + chunk);
          outputChars += text.length;
          push({ type: "content_block_delta", index, delta: { type: "text_delta", text } });
          n++;
          if (part.burstEvery && n % part.burstEvery === 0) t += part.burstPauseMs ?? 800;
          else t += (part.intervalMs ?? 25) + (part.jitterMs ? rng() * part.jitterMs : 0);
        }
        push({ type: "content_block_stop", index });
        index++;
        break;
      }
    }
  }

  const stopReason = script.stopReason ?? "end_turn";
  const outputTokens = script.outputTokens ?? Math.max(1, Math.round(outputChars / 4));
  push({
    type: "message_delta",
    delta: {
      stop_reason: stopReason,
      stop_sequence: null,
      container: null,
      stop_details:
        stopReason === "refusal"
          ? ({
              type: "refusal",
              category: script.stopDetails?.category ?? null,
              explanation: script.stopDetails?.explanation ?? null,
              fallback_credit_token: null,
              fallback_has_prefill_claim: null,
              recommended_model: null,
            } as unknown as Anthropic.Beta.BetaRefusalStopDetails)
          : null,
    },
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      iterations:
        script.iterations ??
        ([
          {
            type: "message",
            model: script.model,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_creation: null,
          },
        ] as Anthropic.Beta.BetaUsage["iterations"]),
      fallback_credit: null,
      server_tool_use: null,
    } as Anthropic.Beta.BetaMessageDeltaUsage,
    context_management: null,
  });
  t += 5;
  push({ type: "message_stop" });
  return lines;
}

function messageStart(model: string, inputTokens: number, seed: number): Anthropic.Beta.BetaMessage {
  return {
    id: `msg_scripted_${seed.toString(36)}`,
    type: "message",
    role: "assistant",
    model,
    content: [],
    stop_reason: null,
    stop_sequence: null,
    stop_details: null,
    container: null,
    context_management: null,
    diagnostics: null,
    usage: {
      input_tokens: inputTokens,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_creation: null,
      iterations: null,
      fallback_credit: null,
      inference_geo: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: null,
      speed: null,
    },
  } as unknown as Anthropic.Beta.BetaMessage;
}

/** D24: streams a script with its pacing, without touching disk. */
export class ScriptedProvider implements Provider {
  readonly name = "scripted" as const;
  constructor(
    private script: Script | ScriptFactory,
    private speed = 1,
    private seed = 1,
  ) {}

  stream(request: ProviderRequest, { signal }: ProviderStreamOptions): AsyncIterable<NormalizableEvent> {
    const script = typeof this.script === "function" ? this.script(request) : this.script;
    return replayLines(scriptToFixture(script, this.seed), this.speed, signal);
  }
}
