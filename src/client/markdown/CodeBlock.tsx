"use client";

import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import type { HighlighterCore, ThemedTokenWithVariants } from "shiki/core";
import { cn } from "@/lib/utils";
import "./code.css";

/** D15: closed fences only, highlighted in idle time via shiki/core; plain and highlighted share one <pre>. */

const LANG_ALIASES: Record<string, string> = {
  ts: "typescript",
  typescript: "typescript",
  tsx: "tsx",
  js: "javascript",
  javascript: "javascript",
  jsx: "jsx",
  json: "json",
  bash: "bash",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  python: "python",
  py: "python",
  go: "go",
  rust: "rust",
  rs: "rust",
  css: "css",
  html: "html",
  sql: "sql",
  yaml: "yaml",
  yml: "yaml",
  markdown: "markdown",
  md: "markdown",
  diff: "diff",
  java: "java",
  kotlin: "kotlin",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  csharp: "csharp",
  cs: "csharp",
  ruby: "ruby",
  rb: "ruby",
  php: "php",
  toml: "toml",
  dockerfile: "dockerfile",
  docker: "dockerfile",
  xml: "xml",
  graphql: "graphql",
  gql: "graphql",
};

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

export function resolveLanguage(lang: string | null): string | null {
  if (!lang) return null;
  return LANG_ALIASES[lang.toLowerCase()] ?? null;
}

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLangs = new Set<string>();
const langPromises = new Map<string, Promise<void>>();

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, light, dark] =
        await Promise.all([
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

export async function highlight(code: string, lang: string): Promise<ThemedTokenWithVariants[][]> {
  const highlighter = await getHighlighter();
  await ensureLanguage(highlighter, lang);
  if (!loadedLangs.has(lang)) throw new Error(`language not loaded: ${lang}`);
  return highlighter.codeToTokensWithThemes(code, {
    lang,
    themes: { light: "github-light", dark: "github-dark" },
  });
}

type IdleHandle = { cancel: () => void };

function scheduleIdle(fn: () => void): IdleHandle {
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    const id = window.requestIdleCallback(fn, { timeout: 2000 });
    return { cancel: () => window.cancelIdleCallback(id) };
  }
  const id = setTimeout(fn, 50);
  return { cancel: () => clearTimeout(id) };
}

const PRE_CLASS =
  "markdown-code-pre m-0 max-w-full overflow-x-auto px-4 py-3 text-code-foreground whitespace-pre";

interface CodeBlockProps {
  code: string;
  lang: string | null;
  closed: boolean;
  className?: string;
}

function CodeBlockImpl({ code, lang, closed, className }: CodeBlockProps) {
  const resolved = resolveLanguage(lang);
  // Tokens are keyed to their code, so a code change stops matching without a reset.
  const [highlighted, setHighlighted] = useState<{
    code: string;
    lang: string;
    tokens: ThemedTokenWithVariants[][];
  } | null>(null);
  const tokens =
    highlighted && highlighted.code === code && highlighted.lang === resolved ? highlighted.tokens : null;
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!closed || !resolved) return;
    let cancelled = false;
    const handle = scheduleIdle(() => {
      highlight(code, resolved)
        .then((result) => {
          if (!cancelled) setHighlighted({ code, lang: resolved, tokens: result });
        })
        .catch(() => {
          // Highlighting is cosmetic; stay plain on any failure.
        });
    });
    return () => {
      cancelled = true;
      handle.cancel();
    };
  }, [code, resolved, closed]);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  const onCopy = () => {
    const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
    if (!clipboard) return;
    clipboard
      .writeText(code)
      .then(() => {
        setCopied(true);
        if (copyTimer.current) clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // Clipboard can be unavailable (permissions, insecure context).
      });
  };

  return (
    <div
      className={cn(
        "markdown-code my-1 max-w-full overflow-hidden rounded-lg border border-border bg-code",
        className,
      )}
      data-closed={closed ? "true" : "false"}
      data-highlighted={tokens ? "true" : "false"}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 text-caption text-muted-foreground">
        <span className="truncate font-mono" aria-label="Language">
          {lang ?? "text"}
        </span>
        <button
          type="button"
          onClick={onCopy}
          aria-live="polite"
          className="touch-target -mr-2 inline-flex items-center justify-center rounded-md px-2 text-caption font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className={PRE_CLASS}>
        <code>{tokens ? renderTokens(tokens) : code}</code>
      </pre>
    </div>
  );
}

function renderTokens(lines: ThemedTokenWithVariants[][]) {
  const out: React.ReactNode[] = [];
  lines.forEach((line, li) => {
    line.forEach((token, ti) => {
      const style = {
        "--shiki-light": token.variants.light?.color,
        "--shiki-dark": token.variants.dark?.color,
      } as CSSProperties;
      out.push(
        <span key={`${li}-${ti}`} data-shiki="" style={style}>
          {token.content}
        </span>,
      );
    });
    if (li < lines.length - 1) out.push("\n");
  });
  return out;
}

export const CodeBlock = memo(CodeBlockImpl);
