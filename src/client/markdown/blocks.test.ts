import { describe, expect, it } from "vitest";
import { hashString, parseFence, splitBlocks, splitBlocksIncremental } from "./blocks";

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

  it("keeps a fence inside a list that a label line leads, and the items after it, in one block", () => {
    const text = ["**Steps:**", "1. Install:", "   ```bash", "   npm i foo", "   ```", "2. Run it"].join("\n");
    const blocks = splitBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe("other");
    expect(blocks[0]!.source).toBe(text);
  });

  it("keeps a loose list together when a label line leads it", () => {
    const blocks = splitBlocks("**Steps:**\n1. one\n\n2. two\n\n   more\n\nAfter");
    expect(blocks.map((b) => b.source)).toEqual(["**Steps:**\n1. one\n\n2. two\n\n   more", "After"]);
  });

  it("still splits off an indented top-level fence right after a paragraph", () => {
    const blocks = splitBlocks("Run this:\n  ```sh\n  npm i\n    --save\n  ```\nafter");
    expect(blocks.map((b) => [b.kind, b.source])).toEqual([
      ["other", "Run this:"],
      ["fence", "  ```sh\n  npm i\n    --save\n  ```"],
      ["other", "after"],
    ]);
    expect(parseFence(blocks[1]!.source, true)).toEqual({ lang: "sh", code: "npm i\n  --save" });
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

  it("strips up to the opener's indent from each line, as CommonMark does", () => {
    expect(parseFence("   ```\n   a\n     b\n c\nd\n   ```", true)).toEqual({ lang: null, code: "a\n  b\nc\nd" });
    expect(parseFence(" ```py\n   x", false)).toEqual({ lang: "py", code: "  x" });
  });

  it("splits incrementally to the same blocks as a full split at every streamed prefix (#25)", () => {
    const text = [
      "## Why resume works",
      "",
      "A paragraph that goes on for a while and keeps going.",
      "",
      "- one item",
      "- two items",
      "  continued here",
      "",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
      "| 3 | 4 |",
      "",
      "```ts",
      "const seq = buffer.events.length;",
      "buffer.events.push({ ...body, seq });",
      "```",
      "",
      "That is the whole protocol.",
    ].join("\n");
    for (let i = 1; i <= text.length; i += 3) {
      const prefix = text.slice(0, i);
      const incremental = splitBlocksIncremental(prefix).map((b) => [b.source, b.kind, b.closed, b.start]);
      const full = splitBlocks(prefix).map((b) => [b.source, b.kind, b.closed, b.start]);
      expect(incremental, `prefix of ${i}`).toEqual(full);
    }
    const blocks = splitBlocks(text);
    for (const b of blocks) expect(text.slice(b.start, b.start + b.source.length)).toBe(b.source);
  });

  it("splits incrementally to the same blocks as a full split, char by char and in chunks", () => {
    const texts = [
      ["**Steps:**", "1. Install:", "   ```bash", "   npm i foo", "   ```", "2. Run it"].join("\n"),
      "1. a\n\n2. b\n\n3. c\n\nDone.",
      "- a\n\n- b\n\n  more\n\n10. ten\n\n11) eleven\n\nend",
      "Run this:\n  ```sh\n  npm i\n  ```\n\n**Then:**\n- x\n\n  ```js\n  y()\n  ```\n\n- z\n\n| a |\n|---|\n| 1 |",
    ];
    const shape = (blocks: ReturnType<typeof splitBlocks>) => blocks.map((b) => [b.key, b.source, b.kind, b.closed, b.start]);
    for (const text of texts) {
      for (const step of [1, 2, 5]) {
        for (let i = 1; i <= text.length + step - 1; i += step) {
          const prefix = text.slice(0, Math.min(i, text.length));
          expect(shape(splitBlocksIncremental(prefix)), `${JSON.stringify(prefix)} by ${step}`).toEqual(
            shape(splitBlocks(prefix)),
          );
        }
      }
    }
  });

  it("keeps an indented fence inside its list item (#24)", () => {
    const text = ["- step one:", "", "  ```ts", "  const a = 1;", "  ```", "", "- step two"].join("\n");
    const blocks = splitBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe("other");
    expect(blocks[0]!.source).toBe(text);
  });
});
