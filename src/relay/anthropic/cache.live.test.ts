// Opt-in because it spends money: pnpm test:cache. Uses the production request builder and a
// fixture above every model's minimum cacheable prefix; asserts cache_read_input_tokens > 0 on the second request.
import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { MODEL_IDS } from "@shared/models";
import type { HistoryMessage } from "./history";
import { buildRequest } from "./request";

const key = process.env.ANTHROPIC_API_KEY;
const run = process.env.CACHE_TEST === "1" && key ? describe : describe.skip;

function bigFixture(): HistoryMessage[] {
  // ~6k tokens of varied prose so no model's minimum is missed.
  const sentences: string[] = [];
  for (let i = 0; i < 700; i++) {
    sentences.push(`Paragraph ${i}: the relay buffers event ${i * 7} and replays it on resume after sequence ${i * 3}.`);
  }
  return [
    { role: "user", content: [{ type: "text", text: `Read this document and reply with one word.\n\n${sentences.join(" ")}`, citations: null }], status: "done" },
  ];
}

run("prompt caching per model", () => {
  const client = new Anthropic({ apiKey: key, maxRetries: 2 });
  for (const model of MODEL_IDS) {
    it(`${model}: second request reads from cache`, async () => {
      const params = buildRequest({ model, thinking: { effort: "low" }, messages: bigFixture() });
      const first = await client.beta.messages.create({ ...params, max_tokens: 32, stream: false });
      expect(first.usage.cache_creation_input_tokens ?? 0).toBeGreaterThan(0);
      const second = await client.beta.messages.create({ ...params, max_tokens: 32, stream: false });
      expect(second.usage.cache_read_input_tokens ?? 0).toBeGreaterThan(0);
      console.log(model, {
        write: first.usage.cache_creation_input_tokens,
        read: second.usage.cache_read_input_tokens,
        input: second.usage.input_tokens,
      });
    }, 120_000);
  }
});
