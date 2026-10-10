import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { MAX_FORKS, MAX_OPTION_PROMPT, MAX_OPTION_TITLE, type ForkOption, type OptionsTrace } from "@shared/forks";
import type { TokenCounts } from "../anthropic/pricing";
import { DetectOutput, RewriteOutput } from "./schema";

export const OPTIONS_MODEL = "claude-haiku-5-5";

export interface MessengerResult {
  options: ForkOption[];
  /** Null for a scripted answer. */
  usage: TokenCounts | null;
  trace?: OptionsTrace;
}

/** Haiku's own messenger: separate client and request shape from the chat relay, never in its history. */
export interface OptionsMessenger {
  readonly name: "haiku" | "scripted";
  detect(reply: string): Promise<MessengerResult>;
  rewrite(options: readonly ForkOption[], instruction: string): Promise<MessengerResult>;
}

const DETECT_SYSTEM = `Decide whether this assistant reply offers a real choice between alternatives worth exploring separately.

It's a choice only if the reply explains two or more mutually exclusive alternatives (approaches, tools, designs, strategies) and the user would pick one and drop the rest. Recommending one still counts. If the user could reasonably do all of them, it's not a choice.

Return no options for everything else: steps, tips, features, facts, examples, pros and cons of one thing, alternatives mentioned only in passing, or a question asking the user about their situation. When unsure, return none.`;

interface Effort {
  thinking: { type: "adaptive" } | { type: "disabled" };
  effort: "low" | "medium";
}
// Measured 2026-10-09: at low effort Haiku never thinks; medium thinks on borderline replies and was as accurate as high, and faster.
const DETECT_EFFORT: Effort = { thinking: { type: "adaptive" }, effort: "medium" };
// Applying one instruction to every prompt needs no judgement.
const REWRITE_EFFORT: Effort = { thinking: { type: "disabled" }, effort: "low" };

const REWRITE_SYSTEM = `You revise a list of chat prompts under one instruction from the user. Each prompt is the user's next message in a conversation that already contains the reply the prompts explore, so it keeps the user's first-person voice and keeps naming its alternative. Apply the instruction to each prompt on its own, as if it were the only one: a prompt never mentions, compares with or depends on the other prompts unless the instruction explicitly asks for that. Return exactly one item per input item, in the same order. Leave titles as they are unless the instruction is about titles.`;

export class LiveOptionsMessenger implements OptionsMessenger {
  readonly name = "haiku" as const;
  constructor(private client: Anthropic = new Anthropic({ maxRetries: 2, timeout: 60_000 })) {}

  async detect(reply: string): Promise<MessengerResult> {
    const { parsed, usage, trace } = await this.ask(DETECT_SYSTEM, `<reply>\n${reply}\n</reply>`, DetectOutput, DETECT_EFFORT);
    return { options: clampOptions(parsed?.options ?? []), usage, trace };
  }

  async rewrite(options: readonly ForkOption[], instruction: string): Promise<MessengerResult> {
    const { parsed, usage, trace } = await this.ask(REWRITE_SYSTEM, `<instruction>\n${instruction}\n</instruction>\n<prompts>\n${JSON.stringify(options)}\n</prompts>`, RewriteOutput, REWRITE_EFFORT);
    return { options: clampOptions(parsed?.options ?? []), usage, trace };
  }

  private async ask<T extends z.ZodType>(system: string, content: string, output: T, mode: Effort): Promise<{ parsed: z.infer<T> | null; usage: TokenCounts; trace: OptionsTrace }> {
    const started = performance.now();
    const message = await this.client.messages.parse({
      model: OPTIONS_MODEL,
      max_tokens: 8192,
      system,
      messages: [{ role: "user", content }],
      thinking: mode.thinking,
      output_config: { effort: mode.effort, format: zodOutputFormat(output) },
    });
    const apiMs = Math.round(performance.now() - started);
    const u = message.usage;
    const usage = {
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    };
    const parsed = message.parsed_output as z.infer<T> | null;
    // Unparsed (a refusal, a truncated answer): the raw text instead.
    const response = parsed ?? (message.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
    const trace: OptionsTrace = {
      model: OPTIONS_MODEL,
      system,
      user: content,
      response,
      stopReason: message.stop_reason ?? null,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      apiMs,
    };
    return { parsed, usage, trace };
  }
}

/** A single alternative is no choice: fewer than two items is an empty list. */
export function clampOptions(raw: readonly { title: string; prompt: string }[]): ForkOption[] {
  const out: ForkOption[] = [];
  for (const o of raw) {
    const title = o.title.trim().slice(0, MAX_OPTION_TITLE);
    const prompt = o.prompt.trim().slice(0, MAX_OPTION_PROMPT);
    if (title && prompt) out.push({ title, prompt });
    if (out.length === MAX_FORKS) break;
  }
  return out.length >= 2 ? out : [];
}

export const SCRIPTED_OPTIONS: ForkOption[] = [
  { title: "Keep SQLite", prompt: "Let's go with option 1, keeping SQLite. Walk me through hardening it: WAL, backups, and the single-writer limits." },
  { title: "Move to Postgres", prompt: "Let's explore option 2, moving to Postgres. What changes in the schema, the migrations and the deployment?" },
  { title: "Embedded then managed", prompt: "Let's take option 3, embedded now and managed later. What has to be designed in up front?" },
];

/** D24: scenario runs and replay mode never spend; the answer comes from the scenario name. */
export class ScriptedOptionsMessenger implements OptionsMessenger {
  readonly name = "scripted" as const;
  constructor(private scenario: string | null) {}

  async detect(): Promise<MessengerResult> {
    return { options: this.scenario === "options_reply" ? SCRIPTED_OPTIONS : [], usage: null };
  }

  async rewrite(options: readonly ForkOption[], instruction: string): Promise<MessengerResult> {
    return { options: clampOptions(options.map((o) => ({ title: o.title, prompt: `${instruction.trim()} ${o.prompt}` }))), usage: null };
  }
}
