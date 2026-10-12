// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createCssVariablesTheme } from "@shikijs/core";
import { describe, expect, it } from "vitest";
import { tokenize } from "./highlight-core";

/** Every `--shiki-*` variable a token can carry must be defined in both palettes of code.css. */
const css = readFileSync(fileURLToPath(new URL("./code.css", import.meta.url)), "utf8");

function definedIn(selector: string): Set<string> {
  const start = css.indexOf(`\n${selector} {`);
  if (start < 0) throw new Error(`code.css has no ${selector} block`);
  const body = css.slice(start, css.indexOf("}", start));
  return new Set([...body.matchAll(/(--shiki-[\w-]+)\s*:/g)].map((m) => m[1]!));
}

const palettes = { light: definedIn(".markdown-code"), dark: definedIn(".dark .markdown-code") };

function varsIn(value: string): string[] {
  return [...value.matchAll(/var\((--shiki-[\w-]+)/g)].map((m) => m[1]!);
}

describe("code.css palettes", () => {
  it("define every variable the css-variables theme puts on a token", () => {
    // Same prefix as highlight-core. `colors` holds the editor background and the terminal ansi-*
    // colours, which tokens never carry (no `ansi` language is loaded); editor.foreground is the
    // colour of an unscoped token.
    const theme = createCssVariablesTheme({ variablePrefix: "--shiki-", variableDefaults: {}, fontStyle: false });
    const emitted = new Set([
      ...varsIn(theme.colors?.["editor.foreground"] ?? ""),
      ...(theme.tokenColors ?? []).flatMap((rule) => varsIn(rule.settings.foreground ?? "")),
    ]);
    expect(emitted).toContain("--shiki-token-inserted");
    for (const [name, defined] of Object.entries(palettes)) {
      expect([...emitted].filter((v) => !defined.has(v)), name).toEqual([]);
    }
  });

  it("colour a diff's inserted, deleted and changed lines with defined variables", async () => {
    const lines = await tokenize("--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n! changed", "diff");
    const colours = new Set(lines.flat().flatMap((t) => (t.l ? varsIn(t.l) : [])));
    for (const v of ["--shiki-token-inserted", "--shiki-token-deleted", "--shiki-token-changed"]) {
      expect(colours).toContain(v);
    }
    for (const [name, defined] of Object.entries(palettes)) {
      expect([...colours].filter((v) => !defined.has(v)), name).toEqual([]);
    }
  });
});
