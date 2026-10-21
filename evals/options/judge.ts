import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { costOf } from "@relay/anthropic/pricing";
import type { ForkOption } from "@shared/forks";
import { JudgeVerdict, type Gold } from "@shared/evals";
import { cached } from "./cache";
import { sha256, sourceOf } from "./cases";

export const JUDGE_MODEL = "claude-sonnet-5-5";

const JUDGE_SYSTEM = `You grade one feature of a chat app. After the assistant replies, a small model reads the reply and, when it offers the user a choice between alternatives, lists them. Each item has a title and a prompt: the message the user would send next, in the same conversation, to explore that one alternative in a new branch of the chat.

You get the reply, a reference list a person wrote of the alternatives it offers, and the model's items. Grade each item, then the list. Give your reasoning before each verdict, and grade only these criteria.

For each item, in order:
- faithful: the prompt describes its alternative as the reply does. It adds no facts, numbers or features the reply doesn't contain and doesn't misstate the alternative. Asking questions about it is fine.
- standalone: sent right after the reply, the prompt makes clear which alternative it picks without the other items in view. It names the alternative (a bare "option 2" doesn't), and it doesn't compare with or depend on the other items.
- concrete: the prompt asks for something specific about that alternative, such as a plan, steps, an implementation or a fuller version, rather than only "tell me more".

For the list:
- coverage: the items match the reference one to one, in substance rather than wording: none missing, none extra, none duplicated. When the reference has more than 10 alternatives, the first 10 suffice.`;

/** Part of every judge cache key: any edit to the judge's rubric, request or verdict schema re-grades. */
export const JUDGE_VERSION = sha256({ code: sourceOf("evals/options/judge.ts"), schema: zodOutputFormat(JudgeVerdict).schema }).slice(0, 12);

export interface Judgement {
  verdict: JudgeVerdict | null;
  costUsd: number;
}

export async function judge(client: Anthropic, reply: string, gold: Gold, options: readonly ForkOption[]): Promise<Judgement> {
  const content = `<reply>\n${reply}\n</reply>\n<reference count="${gold.count}">\n${JSON.stringify(gold.titles)}\n</reference>\n<items>\n${JSON.stringify(options)}\n</items>`;
  const message = await client.messages.parse({
    model: JUDGE_MODEL,
    max_tokens: 8192,
    system: JUDGE_SYSTEM,
    messages: [{ role: "user", content }],
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: zodOutputFormat(JudgeVerdict) },
  });
  const costUsd = costOf(JUDGE_MODEL, {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
  });
  const verdict = message.parsed_output;
  // A verdict that doesn't grade every item can't be lined up with them.
  return { verdict: verdict && verdict.options.length === options.length ? verdict : null, costUsd };
}

const Judgement = z.object({ verdict: JudgeVerdict.nullable(), costUsd: z.number() });

/** Runs and calibration share the cache, so grading an answer already graded is free. */
export function judgeCached(client: Anthropic, reply: string, gold: Gold, options: readonly ForkOption[]) {
  return cached("judge", { JUDGE_VERSION, reply, gold, options }, Judgement, () => judge(client, reply, gold, options), (j) => j.verdict !== null);
}
