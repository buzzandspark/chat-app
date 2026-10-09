import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { MAX_FORKS, MAX_OPTION_PROMPT, MAX_OPTION_TITLE, type ForkOption } from "@shared/forks";
import type { TokenCounts } from "../anthropic/pricing";
import { OptionsOutput } from "./schema";

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

const DETECT_SYSTEM = `You read one assistant reply from a chat app and decide whether it presents the user with a choice: two or more distinct, mutually exclusive alternatives the user is meant to pick between, such as approaches, tools, designs, plans or versions of one thing.
Most replies do not. The steps of one procedure, a list of tips, features or facts, the pros and cons of one thing, a ranked list that ends in a single recommendation, follow-up suggestions, and questions back to the user are not a choice. When in doubt, it is not a choice.
Set is_choice accordingly. When it is a choice, list one item per alternative in the reply's order: a title of at most four words for a tab, and the message a user would send in a new chat to explore that alternative in depth, written in the user's voice and naming it. When it is not a choice, leave the list empty.`;

const REWRITE_SYSTEM = `You revise a list of chat prompts, each with a tab title, under one instruction from the user. Keep one item per input item in the same order, apply the instruction to every prompt, keep each title at most four words, and set is_choice to true.`;

export class LiveOptionsMessenger implements OptionsMessenger {
  readonly name = "haiku" as const;
  constructor(private client: Anthropic = new Anthropic({ maxRetries: 2, timeout: 60_000 })) {}

  detect(reply: string): Promise<MessengerResult> {
    return this.ask(DETECT_SYSTEM, `<reply>\n${reply}\n</reply>`);
  }

  rewrite(options: readonly ForkOption[], instruction: string): Promise<MessengerResult> {
    return this.ask(REWRITE_SYSTEM, `<instruction>\n${instruction}\n</instruction>\n<prompts>\n${JSON.stringify(options)}\n</prompts>`);
  }

  private async ask(system: string, content: string): Promise<MessengerResult> {
    const message = await this.client.messages.parse({
      model: OPTIONS_MODEL,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content }],
      output_config: { effort: "low", format: zodOutputFormat(OptionsOutput) },
    });
    const u = message.usage;
    const parsed = message.parsed_output;
    return {
      options: parsed?.is_choice ? clampOptions(parsed.options) : [],
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
  { title: "Keep SQLite", prompt: "Let's go with keeping SQLite. Walk me through hardening it: WAL, backups, and the single-writer limits." },
  { title: "Move to Postgres", prompt: "Let's explore moving to Postgres. What changes in the schema, the migrations and the deployment?" },
  { title: "Embedded then managed", prompt: "Let's look at the staged path: embedded now, a managed database later. What has to be designed in up front?" },
];

/** D24: scenario runs and replay mode never spend; the answer comes from the scenario name. */
export class ScriptedOptionsMessenger implements OptionsMessenger {
  readonly name = "scripted" as const;
  constructor(private scenario: string | null) {}

  async detect(): Promise<MessengerResult> {
    return { options: this.scenario === "options_reply" ? SCRIPTED_OPTIONS : [], usage: null };
  }

  async rewrite(options: readonly ForkOption[], instruction: string): Promise<MessengerResult> {
    const word = instruction.trim().split(/\s+/)[0] ?? "";
    return {
      options: clampOptions(options.map((o) => ({ title: `${word} ${o.title}`, prompt: `${instruction.trim()} ${o.prompt}` }))),
      usage: null,
    };
  }
}
