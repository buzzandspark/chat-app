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

const DETECT_SYSTEM = `You read one assistant reply from a chat app and decide whether it lays out options: alternatives the user could choose between, such as approaches, libraries, designs or plans. The steps of one procedure, a list of facts, or a single recommendation are not options.
Return one item per option in the reply's order, and an empty list when the reply has none. Each item has a title of at most four words for a tab, and the message a user would send in a new chat to explore that option in depth, written in the user's voice and naming the option.`;

const REWRITE_SYSTEM = `You revise a list of chat prompts, each with a tab title, under one instruction from the user. Keep one item per input item in the same order, apply the instruction to every prompt, and keep each title at most four words.`;

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
    return {
      options: clampOptions(message.parsed_output?.options ?? []),
      usage: {
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      },
    };
  }
}

export function clampOptions(raw: readonly { title: string; prompt: string }[]): ForkOption[] {
  const out: ForkOption[] = [];
  for (const o of raw) {
    const title = o.title.trim().slice(0, MAX_OPTION_TITLE);
    const prompt = o.prompt.trim().slice(0, MAX_OPTION_PROMPT);
    if (title && prompt) out.push({ title, prompt });
    if (out.length === MAX_FORKS) break;
  }
  return out;
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
