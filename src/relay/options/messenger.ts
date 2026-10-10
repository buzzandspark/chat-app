import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { MAX_FORKS, MAX_OPTION_PROMPT, MAX_OPTION_TITLE, type ForkOption } from "@shared/forks";
import type { TokenCounts } from "../anthropic/pricing";
import { CHOICE, DetectOutput, RewriteOutput } from "./schema";

export const OPTIONS_MODEL = "claude-haiku-5-5";

export interface MessengerResult {
  options: ForkOption[];
  /** Null for a scripted answer. */
  usage: TokenCounts | null;
}

/** Haiku's own messenger: separate client and request shape from the chat relay, never in its history. */
export interface OptionsMessenger {
  readonly name: "haiku" | "scripted";
  detect(reply: string): Promise<MessengerResult>;
  rewrite(options: readonly ForkOption[], instruction: string): Promise<MessengerResult>;
}

const DETECT_SYSTEM = `You classify one assistant reply from a chat app and, only when it is a genuine choice, draft what the user would send next in this same conversation to explore each alternative.

A choice is a reply built around two or more alternatives, each explained in its own right, that the user could pick between: the user would take one and drop the others. It is still a choice when the reply recommends one of them. Ask: could the user reasonably do all of these? Then it is not a choice. The steps of one procedure, tips, features, facts, examples, parts of one plan, and the pros and cons of one thing are not a choice; neither are alternatives mentioned only in passing. A question asking the user for a fact about their situation is not a choice, even when it lists possible answers; a reply that lays out alternatives and then asks which the user prefers still is one. Most replies are not a choice; when in doubt, it is not.

Decide kind first. Fill options only for alternatives; otherwise leave it empty.`;

const REWRITE_SYSTEM = `You revise a list of chat prompts under one instruction from the user. Each prompt is the user's next message in a conversation that already contains the reply the prompts explore, so it keeps the user's first-person voice and keeps naming its alternative. Apply the instruction to each prompt on its own, as if it were the only one: a prompt never mentions, compares with or depends on the other prompts unless the instruction explicitly asks for that. Return exactly one item per input item, in the same order. Leave titles as they are unless the instruction is about titles.`;

export class LiveOptionsMessenger implements OptionsMessenger {
  readonly name = "haiku" as const;
  constructor(private client: Anthropic = new Anthropic({ maxRetries: 2, timeout: 60_000 })) {}

  async detect(reply: string): Promise<MessengerResult> {
    const { parsed, usage } = await this.ask(DETECT_SYSTEM, `<reply>\n${reply}\n</reply>`, DetectOutput);
    return { options: parsed?.kind === CHOICE ? clampOptions(parsed.options) : [], usage };
  }

  async rewrite(options: readonly ForkOption[], instruction: string): Promise<MessengerResult> {
    const { parsed, usage } = await this.ask(REWRITE_SYSTEM, `<instruction>\n${instruction}\n</instruction>\n<prompts>\n${JSON.stringify(options)}\n</prompts>`, RewriteOutput);
    return { options: clampOptions(parsed?.options ?? []), usage };
  }

  private async ask<T extends z.ZodType>(system: string, content: string, output: T): Promise<{ parsed: z.infer<T> | null; usage: TokenCounts }> {
    const message = await this.client.messages.parse({
      model: OPTIONS_MODEL,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content }],
      output_config: { effort: "low", format: zodOutputFormat(output) },
    });
    const u = message.usage;
    return {
      parsed: message.parsed_output as z.infer<T> | null,
      usage: {
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      },
    };
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
