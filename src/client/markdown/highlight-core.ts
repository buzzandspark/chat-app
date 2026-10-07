import type { HighlighterCore } from "shiki/core";

/**
 * D15: shiki core with the JavaScript regex engine and one chunk per language; shared by the worker
 * and the in-thread fallback. Loaded lazily (see highlight-runtime), never with the route.
 */

export type HighlightToken = { c: string; l?: string; d?: string };
export type HighlightLine = HighlightToken[];

// Static import map so the bundler can split one chunk per language.
const LANG_LOADERS: Record<string, () => Promise<{ default: unknown }>> = {
  typescript: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  bash: () => import("shiki/langs/bash.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  kotlin: () => import("shiki/langs/kotlin.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  ruby: () => import("shiki/langs/ruby.mjs"),
  php: () => import("shiki/langs/php.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  dockerfile: () => import("shiki/langs/dockerfile.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  graphql: () => import("shiki/langs/graphql.mjs"),
};

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLangs = new Set<string>();
const langPromises = new Map<string, Promise<void>>();

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, light, dark] = await Promise.all([
        import("shiki/core"),
        import("shiki/engine/javascript"),
        import("shiki/themes/github-light.mjs"),
        import("shiki/themes/github-dark.mjs"),
      ]);
      return createHighlighterCore({
        engine: createJavaScriptRegexEngine({ forgiving: true }),
        themes: [light.default, dark.default],
        langs: [],
      });
    })();
  }
  return highlighterPromise;
}

async function ensureLanguage(highlighter: HighlighterCore, lang: string): Promise<void> {
  if (loadedLangs.has(lang)) return;
  let p = langPromises.get(lang);
  if (!p) {
    const loader = LANG_LOADERS[lang];
    if (!loader) return;
    p = loader().then(async (mod) => {
      await highlighter.loadLanguage(mod.default as Parameters<HighlighterCore["loadLanguage"]>[0]);
      loadedLangs.add(lang);
    });
    langPromises.set(lang, p);
  }
  await p;
}

/** Tokenises on whatever thread calls it; the result is compact and structured-cloneable. */
export async function tokenize(code: string, lang: string): Promise<HighlightLine[]> {
  const highlighter = await getHighlighter();
  await ensureLanguage(highlighter, lang);
  if (!loadedLangs.has(lang)) throw new Error(`language not loaded: ${lang}`);
  const lines = highlighter.codeToTokensWithThemes(code, { lang, themes: { light: "github-light", dark: "github-dark" } });
  return lines.map((line) =>
    line.map((token) => {
      const t: HighlightToken = { c: token.content };
      if (token.variants.light?.color) t.l = token.variants.light.color;
      if (token.variants.dark?.color) t.d = token.variants.dark.color;
      return t;
    }),
  );
}
