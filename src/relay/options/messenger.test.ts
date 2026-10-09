import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { MAX_FORKS, MAX_OPTION_TITLE } from "@shared/forks";
import { clampOptions, LiveOptionsMessenger, OPTIONS_MODEL } from "./messenger";

describe("options messenger", () => {
  it("asks Haiku with a structured output format at low effort and maps the parsed answer", async () => {
    const parse = vi.fn().mockResolvedValue({
      parsed_output: {
        is_choice: true,
        options: [{ title: " Keep SQLite ", prompt: " Let's keep SQLite. " }, { title: "", prompt: "dropped" }, { title: "Postgres", prompt: "Let's move." }],
      },
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: null, cache_creation_input_tokens: null },
    });
    const client = { messages: { parse } } as unknown as Anthropic;
    const result = await new LiveOptionsMessenger(client).detect("Here are two ways");
    expect(result.options).toEqual([
      { title: "Keep SQLite", prompt: "Let's keep SQLite." },
      { title: "Postgres", prompt: "Let's move." },
    ]);
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 });
    const params = parse.mock.calls[0]![0] as { model: string; output_config: { effort: string; format: { type: string } }; messages: { content: string }[] };
    expect(params.model).toBe(OPTIONS_MODEL);
    expect(params.output_config.effort).toBe("low");
    expect(params.output_config.format.type).toBe("json_schema");
    expect(params.messages[0]!.content).toContain("Here are two ways");
  });

  it("no choice, or a single alternative, is an empty list", async () => {
    const answer = (parsed_output: unknown) => ({ messages: { parse: vi.fn().mockResolvedValue({ parsed_output, usage: { input_tokens: 1, output_tokens: 1 } }) } }) as unknown as Anthropic;
    const two = [{ title: "A", prompt: "a" }, { title: "B", prompt: "b" }];
    expect((await new LiveOptionsMessenger(answer({ is_choice: false, options: two })).detect("x")).options).toEqual([]);
    expect((await new LiveOptionsMessenger(answer({ is_choice: true, options: two.slice(0, 1) })).detect("x")).options).toEqual([]);
    expect((await new LiveOptionsMessenger(answer(null)).detect("x")).options).toEqual([]);
    expect(clampOptions(two.slice(0, 1))).toEqual([]);
  });

  it("clamps titles and prompts and caps the list", () => {
    const many = Array.from({ length: MAX_FORKS + 3 }, (_, i) => ({ title: `t${i}`.padEnd(MAX_OPTION_TITLE + 5, "x"), prompt: `p${i}` }));
    const out = clampOptions(many);
    expect(out).toHaveLength(MAX_FORKS);
    expect(out[0]!.title).toHaveLength(MAX_OPTION_TITLE);
  });
});
