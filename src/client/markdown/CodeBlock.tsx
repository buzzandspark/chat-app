"use client";

import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { highlight, highlightSource, resolveLanguage, type HighlightLine } from "./highlight";
import "./code.css";

/**
 * Closed fences only. Spans commit in line groups across idle callbacks so no frame inserts thousands of
 * nodes; plain and highlighted text share identical metrics, so highlighting changes paint only.
 */

const GROUP_LINES = 16;

type IdleHandle = { cancel: () => void };

function scheduleIdle(fn: () => void, timeout = 2000): IdleHandle {
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    const id = window.requestIdleCallback(fn, { timeout });
    return { cancel: () => window.cancelIdleCallback(id) };
  }
  const id = setTimeout(fn, 50);
  return { cancel: () => clearTimeout(id) };
}

const PRE_CLASS = "markdown-code-pre m-0 max-w-full overflow-x-auto px-4 py-3 text-code-foreground whitespace-pre";

interface CodeBlockProps {
  code: string;
  lang: string | null;
  closed: boolean;
  className?: string;
}

interface Highlighted {
  code: string;
  lang: string;
  lines: HighlightLine[];
}

function CodeBlockImpl({ code, lang, closed, className }: CodeBlockProps) {
  const resolved = resolveLanguage(lang);
  // Tokens are keyed to their code, so a code change stops matching without a reset.
  const [highlighted, setHighlighted] = useState<Highlighted | null>(null);
  const lines = highlighted && highlighted.code === code && highlighted.lang === resolved ? highlighted.lines : null;
  // Line groups committed to the DOM so far; starts over whenever the token set changes.
  const [committedFor, setCommittedFor] = useState<HighlightLine[] | null>(null);
  const [committed, setCommitted] = useState(0);
  if (lines !== committedFor) {
    setCommittedFor(lines);
    setCommitted(0);
  }
  const plainLines = useMemo(() => code.split("\n"), [code]);
  const groups = lines ? Math.ceil(plainLines.length / GROUP_LINES) : 0;
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!closed || !resolved) return;
    let cancelled = false;
    const handle = scheduleIdle(() => {
      highlight(code, resolved)
        .then((result) => {
          if (!cancelled) setHighlighted({ code, lang: resolved, lines: result });
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
    if (!lines || committed >= groups) return;
    const handle = scheduleIdle(() => setCommitted((c) => Math.min(groups, c + 1)), 100);
    return () => handle.cancel();
  }, [lines, committed, groups]);

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

  // Always line groups, so a delta re-lays out one contained group, not the whole <pre>. If shiki ever
  // splits lines differently, the tokens are dropped rather than risk the text.
  const usable = closed && lines && lines.length === plainLines.length ? lines : null;
  const body: ReactNode = renderGroups(usable, plainLines, usable ? committed : 0);

  return (
    <div
      className={cn("markdown-code my-1 max-w-full overflow-hidden rounded-lg border border-border bg-code", className)}
      data-closed={closed ? "true" : "false"}
      data-highlighted={lines ? "true" : "false"}
      data-highlight-source={lines ? highlightSource() : undefined}
      data-committed={lines ? (committed >= groups ? "all" : String(committed)) : undefined}
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
        <code>{body}</code>
      </pre>
    </div>
  );
}

const LINE_PX = 13 * 1.55; // code.css: 0.8125rem at 1.55
const CH_PX = 13 * 0.6; // monospace advance at 0.8125rem

/** Memoised on the token array and range, so later commits do not reconcile it again. */
const LineGroup = memo(function LineGroup({
  lines,
  text,
  start,
  end,
  last,
  widthPx,
}: {
  lines: HighlightLine[] | null;
  /** A streaming delta changes only the last group's string, so earlier groups skip. */
  text: string;
  start: number;
  end: number;
  last: boolean;
  /** The block's longest line, so a skipped group keeps the <pre>'s horizontal scroll range. */
  widthPx: number;
}) {
  const style = { "--group-w": `${widthPx}px`, "--group-h": `${Math.round((end - start) * LINE_PX)}px` } as CSSProperties;
  let kids: ReactNode;
  if (lines) {
    const out: ReactNode[] = [];
    for (let li = start; li < end; li++) {
      lines[li]!.forEach((token, ti) => {
        out.push(
          <span key={`${li}-${ti}`} data-shiki="" style={token.l ? { color: token.l } : undefined}>
            {token.c}
          </span>,
        );
      });
      if (li < end - 1 || !last) out.push("\n");
    }
    kids = out;
  } else {
    kids = text + (last ? "" : "\n");
  }
  return (
    <span className="code-group block" data-lines={`${start}-${end}`} style={style}>
      {kids}
    </span>
  );
});

/** The block as groups; committed ones carry highlighted spans, the rest their plain lines. The text never changes. */
function renderGroups(lines: HighlightLine[] | null, plain: string[], committedGroups: number): ReactNode[] {
  const out: ReactNode[] = [];
  const total = plain.length;
  let longest = 0;
  for (const line of plain) if (line.length > longest) longest = line.length;
  const widthPx = Math.ceil(longest * CH_PX);
  for (let g = 0; g * GROUP_LINES < total; g++) {
    const start = g * GROUP_LINES;
    const end = Math.min(total, start + GROUP_LINES);
    out.push(
      <LineGroup
        key={g}
        lines={g < committedGroups ? lines : null}
        text={plain.slice(start, end).join("\n")}
        start={start}
        end={end}
        last={end === total}
        widthPx={widthPx}
      />,
    );
  }
  return out;
}

export const CodeBlock = memo(CodeBlockImpl);
