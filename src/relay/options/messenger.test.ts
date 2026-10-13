import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { MAX_FORKS, MAX_OPTION_TITLE } from "@shared/forks";
import { clampOptions, completeOptions, LiveOptionsMessenger, OPTIONS_MODEL, OptionsCallError } from "./messenger";

/** A client whose messages.stream emits `text` in small pieces, then resolves the final message. */
function streaming(text: string) {
  const stream = vi.fn(() => {
    const handlers: ((delta: string) => void)[] = [];
    return {
      on(event: string, handler: (delta: string) => void) {
        if (event === "text") handlers.push(handler);
        return this;
      },
      async finalMessage() {
        for (let i = 0; i < text.length; i += 7) for (const h of handlers) h(text.slice(i, i + 7));
        return { content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: null, cache_creation_input_tokens: null } };
      },
    };
  });
  return { client: { messages: { stream } } as unknown as Anthropic, stream };
}

/** A real SDK client over a server-sent event stream that, with `fail`, breaks off after the events. */
function overSse(events: { type: string }[], fail?: Error) {
  const body = new TextEncoder().encode(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""));
  const fetch = async () => {
    let sent = false;
    return new Response(
      new ReadableStream({
        pull(controller) {
          if (sent) return fail ? controller.error(fail) : controller.close();
          sent = true;
          controller.enqueue(body);
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  };
  return new Anthropic({ apiKey: "test", fetch });
}

const CUT_OFF = '{"count":2,"options":[{"title":"A","prompt":"a"},{"title":"B","pro';
const HEAD = [
  { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: OPTIONS_MODEL, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 900, output_tokens: 1 } } },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: CUT_OFF } },
];

describe("options messenger", () => {
  it("streams the detection at medium effort with thinking, reporting the count first and each option as it completes", async () => {
    const answer = JSON.stringify({
      count: 3,
      options: [{ title: " Keep SQLite ", prompt: " Let's keep SQLite. " }, { title: "", prompt: "dropped" }, { title: "Postgres", prompt: "Let's move." }],
    });
    const { client, stream } = streaming(answer);
    const progress: unknown[] = [];
    const result = await new LiveOptionsMessenger(client).detect("Here are two ways", (p) => progress.push(p));
    expect(result.options).toEqual([
      { title: "Keep SQLite", prompt: "Let's keep SQLite." },
      { title: "Postgres", prompt: "Let's move." },
    ]);
    // The count before any option, then the options as each one closes.
    expect(progress[0]).toEqual({ count: 3 });
    expect(progress.slice(1)).toEqual([{ options: [{ title: "Keep SQLite", prompt: "Let's keep SQLite." }] }, { options: result.options }]);
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 });
    expect(result.trace).toMatchObject({ model: OPTIONS_MODEL, user: expect.stringContaining("Here are two ways"), inputTokens: 10, outputTokens: 5, stopReason: "end_turn" });
    expect(result.trace!.system).toContain("weigh against each other");
    expect(result.trace!.response).toMatchObject({ count: 3 });
    const params = (stream.mock.calls[0] as unknown as [unknown])[0] as { model: string; system: string; thinking: unknown; output_config: { effort: string; format: { type: string } }; messages: { content: string }[] };
    expect(params.model).toBe(OPTIONS_MODEL);
    expect(params.output_config.effort).toBe("medium");
    expect(params.thinking).toEqual({ type: "adaptive" });
    expect(params.output_config.format.type).toBe("json_schema");
    expect(params.messages[0]!.content).toContain("Here are two ways");
    expect(params.system).toContain("parts of one whole");
    // The count comes first in the schema; the prompt-writing rules ride in it too.
    const format = JSON.stringify(params.output_config.format);
    expect(format.indexOf('"count"')).toBeLessThan(format.indexOf('"options"'));
    expect(format).toContain("next message in this same conversation");
  });

  it("no choice, a single alternative, or an unparsable answer is an empty list", async () => {
    const two = [{ title: "A", prompt: "a" }, { title: "B", prompt: "b" }];
    expect((await new LiveOptionsMessenger(streaming(JSON.stringify({ count: 0, options: [] })).client).detect("x")).options).toEqual([]);
    expect((await new LiveOptionsMessenger(streaming(JSON.stringify({ count: 1, options: two.slice(0, 1) })).client).detect("x")).options).toEqual([]);
    const refused = await new LiveOptionsMessenger(streaming("I can't help with that.").client).detect("x");
    expect(refused.options).toEqual([]);
    expect(refused.trace!.response).toBe("I can't help with that.");
    expect((await new LiveOptionsMessenger(streaming(JSON.stringify({ options: two })).client).rewrite(two, "shorter")).options).toEqual(two);
    expect(clampOptions(two.slice(0, 1))).toEqual([]);
  });

  it("a cut-off answer keeps the usage it was billed and has no options", async () => {
    const tail = [{ type: "content_block_stop", index: 0 }, { type: "message_delta", delta: { stop_reason: "max_tokens", stop_sequence: null }, usage: { output_tokens: 8192 } }, { type: "message_stop" }];
    const messenger = new LiveOptionsMessenger(overSse([...HEAD, ...tail]));
    for (const result of [await messenger.detect("x"), await messenger.rewrite([{ title: "A", prompt: "a" }], "shorter")]) {
      expect(result.options).toEqual([]);
      expect(result.usage).toEqual({ inputTokens: 900, outputTokens: 8192, cacheReadTokens: 0, cacheWriteTokens: 0 });
      expect(result.trace).toMatchObject({ stopReason: "max_tokens", response: CUT_OFF });
    }
  });

  it("a call that breaks off after Haiku started fails with the cost so far, estimated from the text", async () => {
    const lost = new Error("socket hang up");
    const err = await new LiveOptionsMessenger(overSse(HEAD, lost)).detect("x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OptionsCallError);
    expect(err).toMatchObject({ usage: { inputTokens: 900, outputTokens: Math.ceil(CUT_OFF.length / 2.5), cacheReadTokens: 0, cacheWriteTokens: 0 } });
    // Nothing started, nothing billed: the error as it came.
    const before = await new LiveOptionsMessenger(overSse([], lost)).detect("x").catch((e: unknown) => e);
    expect(before).not.toBeInstanceOf(OptionsCallError);
  });

  it("completeOptions reads the options finished so far from a partial answer", () => {
    expect(completeOptions('{"count":2,"opt')).toEqual([]);
    expect(completeOptions('{"count":2,"options":[{"title":"A","prompt":"a {b}"},{"title":"B","pro')).toEqual([{ title: "A", prompt: "a {b}" }]);
    expect(completeOptions('{"count":2,"options":[{"title":"A","prompt":"a"},{"title":"B","prompt":"b"}]}')).toHaveLength(2);
  });

  it("the rewrite applies an instruction to each prompt on its own", async () => {
    const { client, stream } = streaming(JSON.stringify({ options: [] }));
    await new LiveOptionsMessenger(client).rewrite([{ title: "A", prompt: "a" }], "assess performance");
    const params = (stream.mock.calls[0] as unknown as [unknown])[0] as { system: string; messages: { content: string }[] };
    expect(params.system).toContain("on its own");
    expect(params.system).toContain("unless the instruction explicitly asks");
    expect(params.messages[0]!.content).toContain("assess performance");
    // A rewrite needs no judgement: thinking off, low effort.
    expect((params as unknown as { thinking: unknown }).thinking).toEqual({ type: "disabled" });
    expect((params as unknown as { output_config: { effort: string } }).output_config.effort).toBe("low");
  });

  it("clamps titles and prompts and caps the list", () => {
    const many = Array.from({ length: MAX_FORKS + 3 }, (_, i) => ({ title: `t${i}`.padEnd(MAX_OPTION_TITLE + 5, "x"), prompt: `p${i}` }));
    const out = clampOptions(many);
    expect(out).toHaveLength(MAX_FORKS);
    expect(out[0]!.title).toHaveLength(MAX_OPTION_TITLE);
  });
});
