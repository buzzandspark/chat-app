import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { MAX_FORKS, MAX_OPTION_PROMPT, MAX_OPTION_TITLE, type ForkOption, type OptionsTrace } from "@shared/forks";
import type { TokenCounts } from "../anthropic/pricing";
import { CHARS_PER_TOKEN } from "../quota";
import { DetectOutput, RewriteOutput } from "./schema";

export const OPTIONS_MODEL = "claude-haiku-5-5";
export const OPTIONS_MAX_TOKENS = 8192;

export interface DetectProgress {
  count?: number;
  /** The options complete so far. */
  options?: ForkOption[];
}

export interface MessengerResult {
  options: ForkOption[];
  /** Null for a scripted answer. */
  usage: TokenCounts | null;
  trace?: OptionsTrace;
}

/** Haiku's own messenger: separate client and request shape from the chat relay, never in its history. */
export interface OptionsMessenger {
  readonly name: "haiku" | "scripted";
  /** What a detection is billed and held at. */
  readonly detectModel: string;
  detect(reply: string, onProgress?: (progress: DetectProgress) => void): Promise<MessengerResult>;
  rewrite(options: readonly ForkOption[], instruction: string): Promise<MessengerResult>;
}

export const DETECT_SYSTEM = `Decide whether this assistant reply lays out distinct alternatives the user might weigh against each other. A menu of ideas or suggestions the user could pick from counts too, even when they could do several of them.

Return none for parts of one whole (steps, tips that together serve one goal, features, facts, examples, pros and cons), alternatives mentioned in passing, or questions about the user's situation. When unsure, return none.`;

export interface Effort {
  thinking: { type: "adaptive" } | { type: "disabled" };
  effort: "low" | "medium" | "high";
}
// Measured 2026-10-09: at low effort Haiku never thinks; medium thinks on borderline replies and was as accurate as high, and faster.
const DETECT_EFFORT: Effort = { thinking: { type: "adaptive" }, effort: "medium" };

/** What a detection sends; the evals in evals/options swap it to compare prompts and models. */
export interface DetectConfig {
  model: string;
  system: string;
  mode: Effort;
}
export const DETECT_CONFIG: DetectConfig = { model: OPTIONS_MODEL, system: DETECT_SYSTEM, mode: DETECT_EFFORT };

// Applying one instruction to every prompt needs no judgement.
const REWRITE_EFFORT: Effort = { thinking: { type: "disabled" }, effort: "low" };

const REWRITE_SYSTEM = `You revise a list of chat prompts under one instruction from the user. Each prompt is the user's next message in a conversation that already contains the reply the prompts explore, so it keeps the user's first-person voice and keeps naming its alternative. Apply the instruction to each prompt on its own, as if it were the only one: a prompt never mentions, compares with or depends on the other prompts unless the instruction explicitly asks for that. Return exactly one item per input item, in the same order. Leave titles as they are unless the instruction is about titles.`;

/** Haiku failed after it started answering; `usage` is the estimated cost so far. */
export class OptionsCallError extends Error {
  constructor(
    public usage: TokenCounts,
    options: ErrorOptions,
  ) {
    super("options_call_failed", options);
    this.name = "OptionsCallError";
  }
}

export class LiveOptionsMessenger implements OptionsMessenger {
  readonly name = "haiku" as const;
  readonly detectModel: string;
  constructor(
    private client: Anthropic = new Anthropic({ maxRetries: 1, timeout: 60_000 }),
    private detectConfig: DetectConfig = DETECT_CONFIG,
  ) {
    this.detectModel = detectConfig.model;
  }

  /** Streamed: the count and each completed option are reported as they arrive. */
  async detect(reply: string, onProgress?: (progress: DetectProgress) => void): Promise<MessengerResult> {
    let count: number | null = null;
    let seen = 0;
    const { system, mode } = this.detectConfig;
    const { parsed, usage, trace } = await this.call(this.detectModel, system, `<reply>\n${reply}\n</reply>`, DetectOutput, mode, (text, delta) => {
      if (count === null) {
        const match = /"count"\s*:\s*(\d+)\s*[,}]/.exec(text);
        if (match) {
          count = Number(match[1]);
          onProgress?.({ count });
        }
      }
      if (onProgress && delta.includes("}")) {
        const options = cleanOptions(completeOptions(text));
        if (options.length > seen) {
          seen = options.length;
          onProgress({ options });
        }
      }
    });
    return { options: clampOptions(parsed?.options ?? []), usage, trace };
  }

  async rewrite(options: readonly ForkOption[], instruction: string): Promise<MessengerResult> {
    const { parsed, usage, trace } = await this.call(OPTIONS_MODEL, REWRITE_SYSTEM, `<instruction>\n${instruction}\n</instruction>\n<prompts>\n${JSON.stringify(options)}\n</prompts>`, RewriteOutput, REWRITE_EFFORT);
    return { options: clampOptions(parsed?.options ?? []), usage, trace };
  }

  private async call<T extends z.ZodType>(
    model: string,
    system: string,
    content: string,
    output: T,
    mode: Effort,
    onText?: (text: string, delta: string) => void,
  ): Promise<{ parsed: z.infer<T> | null; usage: TokenCounts; trace: OptionsTrace }> {
    const started = performance.now();
    // Without the SDK's own parse, which throws on a cut-off answer and loses its usage.
    const { type, schema } = zodOutputFormat(output);
    const stream = this.client.messages.stream({
      model,
      max_tokens: OPTIONS_MAX_TOKENS,
      system,
      messages: [{ role: "user", content }],
      thinking: mode.thinking,
      output_config: { effort: mode.effort, format: { type, schema } },
    });
    let text = "";
    let thoughtChars = 0;
    stream.on("text", (delta) => {
      text += delta;
      onText?.(text, delta);
    });
    stream.on("thinking", (delta) => {
      thoughtChars += delta.length;
    });
    let message: Anthropic.Message;
    try {
      message = await stream.finalMessage();
    } catch (err) {
      const snapshot = stream.currentMessage;
      if (!snapshot) throw err;
      const outputTokens = Math.max(snapshot.usage.output_tokens, Math.ceil((text.length + thoughtChars) / CHARS_PER_TOKEN));
      throw new OptionsCallError({ ...toUsage(snapshot.usage), outputTokens }, { cause: err });
    }
    const usage = toUsage(message.usage);
    let parsed: z.infer<T> | null = null;
    try {
      const result = output.safeParse(JSON.parse(text));
      if (result.success) parsed = result.data;
    } catch {
      // A refusal or a cut-off answer: no options, and the raw text in the trace.
    }
    return { parsed, usage, trace: toTrace(model, system, content, parsed ?? text, message.stop_reason ?? null, usage, Math.round(performance.now() - started)) };
  }
}

function toUsage(u: Anthropic.Usage): TokenCounts {
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
}

function toTrace(model: string, system: string, user: string, response: unknown, stopReason: string | null, usage: TokenCounts, apiMs: number): OptionsTrace {
  return { model, system, user, response, stopReason, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, apiMs };
}

/** The options completed so far in a partial `{"count":…,"options":[…` answer. */
export function completeOptions(text: string): { title: string; prompt: string }[] {
  const key = text.indexOf('"options"');
  const start = key === -1 ? -1 : text.indexOf("[", key);
  if (start === -1) return [];
  for (let end = text.lastIndexOf("}"); end > start; end = text.lastIndexOf("}", end - 1)) {
    try {
      const list: unknown = JSON.parse(`${text.slice(start, end + 1)}]`);
      if (Array.isArray(list)) return list.filter((o): o is { title: string; prompt: string } => typeof o?.title === "string" && typeof o?.prompt === "string");
    } catch {
      // Cut inside an option: try the one before.
    }
  }
  return [];
}

/** Trimmed, clamped, without empty items, at most MAX_FORKS. */
function cleanOptions(raw: readonly { title: string; prompt: string }[]): ForkOption[] {
  const out: ForkOption[] = [];
  for (const o of raw) {
    const title = o.title.trim().slice(0, MAX_OPTION_TITLE);
    const prompt = o.prompt.trim().slice(0, MAX_OPTION_PROMPT);
    if (title && prompt) out.push({ title, prompt });
    if (out.length === MAX_FORKS) break;
  }
  return out;
}

/** A single alternative is no choice: fewer than two items is an empty list. */
export function clampOptions(raw: readonly { title: string; prompt: string }[]): ForkOption[] {
  const out = cleanOptions(raw);
  return out.length >= 2 ? out : [];
}

export const SCRIPTED_OPTIONS: ForkOption[] = [
  { title: "Keep SQLite", prompt: "Let's go with option 1, keeping SQLite. Walk me through hardening it: WAL, backups, and the single-writer limits." },
  { title: "Move to Postgres", prompt: "Let's explore option 2, moving to Postgres. What changes in the schema, the migrations and the deployment?" },
  { title: "Embedded then managed", prompt: "Let's take option 3, embedded now and managed later. What has to be designed in up front?" },
];

/** Scenario runs and replay mode never spend; the answer comes from the scenario name. */
export class ScriptedOptionsMessenger implements OptionsMessenger {
  readonly name = "scripted" as const;
  readonly detectModel = OPTIONS_MODEL;
  constructor(private scenario: string | null) {}

  /** The options scenario paces itself like Haiku (count, then the list) so the button's waiting states can be seen and tested. */
  async detect(_reply: string, onProgress?: (progress: DetectProgress) => void): Promise<MessengerResult> {
    if (this.scenario !== "options_reply") {
      onProgress?.({ count: 0 });
      return { options: [], usage: null };
    }
    await new Promise((r) => setTimeout(r, 400));
    onProgress?.({ count: SCRIPTED_OPTIONS.length });
    await new Promise((r) => setTimeout(r, 1500));
    return { options: SCRIPTED_OPTIONS, usage: null };
  }

  async rewrite(options: readonly ForkOption[], instruction: string): Promise<MessengerResult> {
    return { options: clampOptions(options.map((o) => ({ title: o.title, prompt: `${instruction.trim()} ${o.prompt}` }))), usage: null };
  }
}
