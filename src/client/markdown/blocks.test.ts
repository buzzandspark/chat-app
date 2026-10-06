import { describe, expect, it } from "vitest";
import { hashString, parseFence, splitBlocks } from "./blocks";

describe("splitBlocks", () => {
  it("splits paragraphs on blank lines and marks only the last block open", () => {
    const blocks = splitBlocks("one\n\ntwo\n\n\nthree");
    expect(blocks.map((b) => b.source)).toEqual(["one", "two", "three"]);
    expect(blocks.map((b) => b.closed)).toEqual([true, true, false]);
    expect(blocks.every((b) => b.kind === "other")).toBe(true);
  });

  it("keeps a fence with blank lines inside as one closed block", () => {
    const src = "intro\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nafter";
    const blocks = splitBlocks(src);
    expect(blocks).toHaveLength(3);
    expect(blocks[1]!.kind).toBe("fence");
    expect(blocks[1]!.closed).toBe(true);
    expect(blocks[1]!.source).toBe("```ts\nconst a = 1;\n\nconst b = 2;\n```");
    expect(blocks[2]!.source).toBe("after");
  });

  it("marks an unclosed fence at the end as open", () => {
    const blocks = splitBlocks("text\n\n```py\nprint(1)\n\nprint(2)");
    expect(blocks).toHaveLength(2);
    expect(blocks[1]!.kind).toBe("fence");
    expect(blocks[1]!.closed).toBe(false);
    expect(blocks[1]!.source).toBe("```py\nprint(1)\n\nprint(2)");
  });

  it("supports tilde fences and ignores a backtick close inside a tilde fence", () => {
    const blocks = splitBlocks("~~~\nx\n```\ny\n~~~\n\nend");
    expect(blocks[0]!.kind).toBe("fence");
    expect(blocks[0]!.closed).toBe(true);
    expect(blocks[0]!.source).toBe("~~~\nx\n```\ny\n~~~");
  });

  it("requires the closing fence to be at least as long as the opener", () => {
    const blocks = splitBlocks("````md\n```js\ncode\n```\n````\n\nafter");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.closed).toBe(true);
    expect(blocks[0]!.source).toBe("````md\n```js\ncode\n```\n````");
  });

  it("does not treat a backtick fence with backticks in the info string as an opener", () => {
    const blocks = splitBlocks("``` a`b\ntext");
    expect(blocks[0]!.kind).toBe("other");
  });

  it("keeps GFM table rows together and tags the block as a table", () => {
    const blocks = splitBlocks("Before\n\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\nAfter");
    expect(blocks).toHaveLength(3);
    expect(blocks[1]!.kind).toBe("table");
    expect(blocks[1]!.source.split("\n")).toHaveLength(4);
  });

  it("keeps a loose list together across blank lines", () => {
    const blocks = splitBlocks("1. one\n\n2. two\n\n   more\n\nnot a list");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.source).toBe("1. one\n\n2. two\n\n   more");
    expect(blocks[1]!.source).toBe("not a list");
  });

  it("keeps an indented code block together across blank lines", () => {
    const blocks = splitBlocks("    a\n\n    b\n\nc");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.source).toBe("    a\n\n    b");
  });

  it("hashes the same source to the same value and different sources differently", () => {
    expect(hashString("hello")).toBe(hashString("hello"));
    expect(hashString("hello")).not.toBe(hashString("hellp"));
    expect(hashString("")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("keeps earlier block keys and hashes stable as text grows", () => {
    const a = splitBlocks("first para\n\nsecond");
    const b = splitBlocks("first para\n\nsecond more words\n\nthird");
    expect(b[0]!.key).toBe(a[0]!.key);
    expect(b[0]!.hash).toBe(a[0]!.hash);
    expect(b[1]!.key).toBe(a[1]!.key);
    expect(b[1]!.closed).toBe(true);
    expect(a[1]!.closed).toBe(false);
  });

  it("splits a 60k character document quickly", () => {
    const para = "The quick brown fox jumps over the lazy dog. ".repeat(6);
    const code = "```ts\n" + "const value = compute(input);\n".repeat(20) + "```";
    const table = "| a | b |\n|---|---|\n" + "| 1 | 2 |\n".repeat(10);
    let doc = "";
    while (doc.length < 60_000) doc += `${para}\n\n${code}\n\n${table}\n\n- item\n- item\n\n`;
    const start = performance.now();
    const blocks = splitBlocks(doc);
    const elapsed = performance.now() - start;
    expect(blocks.length).toBeGreaterThan(50);
    expect(elapsed).toBeLessThan(20);
  });
});

describe("parseFence", () => {
  it("extracts language and body from a closed fence", () => {
    expect(parseFence("```ts title=x\nlet a;\n```", true)).toEqual({ lang: "ts", code: "let a;" });
  });
  it("keeps the whole body for an unclosed fence", () => {
    expect(parseFence("```\nline1\nline2", false)).toEqual({ lang: null, code: "line1\nline2" });
  });
  it("handles an opener with no body yet", () => {
    expect(parseFence("```json", false)).toEqual({ lang: "json", code: "" });
  });
});
