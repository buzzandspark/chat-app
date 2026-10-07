"use client";

import { memo, useMemo, type ReactNode } from "react";
import { Lexer, type Token, type Tokens } from "marked";
import { cn } from "@/lib/utils";
import { parseFence, splitBlocksIncremental, type MarkdownBlock } from "./blocks";
import { CodeBlock } from "./CodeBlock";

/** D9: finished blocks memoise by hash; marked's lexer tokens render to React text nodes, never innerHTML. */

interface MarkdownProps {
  text: string;
  streaming: boolean;
  className?: string;
  /** Test hook: called on every Block render with the block key. */
  onBlockRender?: (key: string) => void;
}

export function Markdown({ text, streaming, className, onBlockRender }: MarkdownProps) {
  const blocks = useMemo(() => splitBlocksIncremental(text), [text]);
  return (
    <div className={cn("markdown min-w-0 max-w-full space-y-3 break-words text-body", className)}>
      {blocks.map((block) => (
        <Block
          key={block.key}
          block={block}
          closed={block.closed || !streaming}
          onRender={onBlockRender}
        />
      ))}
    </div>
  );
}

interface BlockProps {
  block: MarkdownBlock;
  closed: boolean;
  onRender?: (key: string) => void;
}

function BlockImpl({ block, closed, onRender }: BlockProps) {
  onRender?.(block.key);
  if (block.kind === "fence") {
    const { lang, code } = parseFence(block.source, block.closed);
    return <CodeBlock code={code} lang={lang} closed={closed && block.closed} />;
  }
  // While a table streams its last row is still being typed: leave it out, so the rows that show are
  // complete and the lexer sees the same shape on every chunk (#23).
  const streamingTable = block.kind === "table" && !closed;
  const source = streamingTable ? dropIncompleteRow(block.source) : block.source;
  const tokens = Lexer.lex(source, { gfm: true });
  if (block.kind === "table" && !tokens.some((t) => t.type === "table")) {
    return <PartialTable source={source} streaming={streamingTable} />;
  }
  return <>{renderTokens(tokens, streamingTable)}</>;
}

const Block = memo(
  BlockImpl,
  (prev, next) =>
    prev.block.hash === next.block.hash &&
    prev.block.kind === next.block.kind &&
    prev.closed === next.closed &&
    prev.onRender === next.onRender,
);

function dropIncompleteRow(source: string): string {
  const lines = source.split("\n");
  // The header and delimiter stay; any later last line may still grow, whether or not it ends in a pipe.
  if (lines.length > 2) return lines.slice(0, -1).join("\n");
  return source;
}

function PartialTable({ source, streaming }: { source: string; streaming: boolean }) {
  const lines = source.split("\n").filter((l) => l.trim() !== "");
  const header = lines[0] ? splitRow(lines[0]) : [];
  const rows = lines.slice(2).map(splitRow);
  return (
    <TableShell streaming={streaming}>
      <thead>
        <tr>
          {header.map((cell, i) => (
            <th key={i} className={TH_CLASS}>
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri} className="border-t border-border">
            {header.map((_, ci) => (
              <td key={ci} className={TD_CLASS}>
                {row[ci] ?? ""}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());
}

const TH_CLASS = "px-3 py-2 text-left text-small font-semibold";
const TD_CLASS = "px-3 py-2 align-top text-small";

/** Fixed column widths while rows stream in, so columns do not re-flow on every chunk; auto once closed. */
function TableShell({ children, streaming = false }: { children: ReactNode; streaming?: boolean }) {
  return (
    <div className="max-w-full overflow-x-auto rounded-lg border border-border">
      <table className={streaming ? "w-full table-fixed border-collapse" : "w-max min-w-full border-collapse"}>{children}</table>
    </div>
  );
}

function alignClass(align: "center" | "left" | "right" | null): string | undefined {
  if (align === "center") return "text-center";
  if (align === "right") return "text-right";
  return undefined;
}

export function renderTokens(tokens: Token[], streamingTable = false): ReactNode[] {
  return tokens.map((token, i) => renderToken(token, i, streamingTable));
}

function children(token: { tokens?: Token[]; text?: string }): ReactNode {
  if (token.tokens && token.tokens.length > 0) return renderTokens(token.tokens);
  return token.text ?? "";
}

function renderToken(token: Token, key: number, streamingTable = false): ReactNode {
  switch (token.type) {
    case "space":
      return null;
    case "heading": {
      const t = token as Tokens.Heading;
      const cls =
        t.depth <= 1
          ? "text-title font-semibold"
          : t.depth === 2
            ? "text-body font-semibold"
            : "text-body font-medium";
      const Tag = `h${Math.min(6, Math.max(1, t.depth))}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return (
        <Tag key={key} className={cn(cls, "mt-2 first:mt-0")}>
          {children(t)}
        </Tag>
      );
    }
    case "paragraph": {
      const t = token as Tokens.Paragraph;
      return (
        <p key={key} className="leading-relaxed">
          {children(t)}
        </p>
      );
    }
    case "text": {
      const t = token as Tokens.Text;
      return <span key={key}>{children(t)}</span>;
    }
    case "strong":
      return <strong key={key}>{children(token as Tokens.Strong)}</strong>;
    case "em":
      return <em key={key}>{children(token as Tokens.Em)}</em>;
    case "del":
      return <del key={key}>{children(token as Tokens.Del)}</del>;
    case "codespan": {
      const t = token as Tokens.Codespan;
      return (
        <code key={key} className="rounded-md bg-code px-1 py-0.5 font-mono text-[0.875em] text-code-foreground">
          {t.text}
        </code>
      );
    }
    case "link": {
      const t = token as Tokens.Link;
      return (
        <a
          key={key}
          href={safeHref(t.href)}
          title={t.title ?? undefined}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline underline-offset-2"
        >
          {children(t)}
        </a>
      );
    }
    case "image": {
      const t = token as Tokens.Image;
      return (
        <a
          key={key}
          href={safeHref(t.href)}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline underline-offset-2"
        >
          {t.text || t.href}
        </a>
      );
    }
    case "br":
      return <br key={key} />;
    case "hr":
      return <hr key={key} className="my-2 border-border" />;
    case "escape":
      return <span key={key}>{(token as Tokens.Escape).text}</span>;
    case "html": {
      const t = token as Tokens.HTML;
      return t.block ? (
        <p key={key} className="whitespace-pre-wrap">
          {t.text}
        </p>
      ) : (
        <span key={key}>{t.text}</span>
      );
    }
    case "blockquote":
      return (
        <blockquote key={key} className="border-l-2 border-border pl-3 text-muted-foreground">
          <div className="space-y-2">{children(token as Tokens.Blockquote)}</div>
        </blockquote>
      );
    case "list": {
      const t = token as Tokens.List;
      const Tag = t.ordered ? "ol" : "ul";
      return (
        <Tag
          key={key}
          start={t.ordered && t.start !== "" ? t.start : undefined}
          className={cn(
            "space-y-1 pl-6",
            t.ordered ? "list-decimal" : "list-disc",
          )}
        >
          {t.items.map((item, j) => renderListItem(item, j))}
        </Tag>
      );
    }
    case "list_item":
      return renderListItem(token as Tokens.ListItem, key);
    case "checkbox": {
      const t = token as Tokens.Checkbox;
      return (
        <input
          key={key}
          type="checkbox"
          checked={t.checked}
          disabled
          readOnly
          aria-label={t.checked ? "Done" : "Not done"}
          className="mr-2 align-middle"
        />
      );
    }
    case "code": {
      const t = token as Tokens.Code;
      return <CodeBlock key={key} code={t.text} lang={t.lang ? t.lang.split(/\s+/)[0]! : null} closed />;
    }
    case "table": {
      const t = token as Tokens.Table;
      return (
        <TableShell key={key} streaming={streamingTable}>
          <thead>
            <tr>
              {t.header.map((cell, ci) => (
                <th key={ci} className={cn(TH_CLASS, alignClass(t.align[ci] ?? null))}>
                  {children(cell)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {t.rows.map((row, ri) => (
              <tr key={ri} className="border-t border-border">
                {row.map((cell, ci) => (
                  <td key={ci} className={cn(TD_CLASS, alignClass(t.align[ci] ?? null))}>
                    {children(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </TableShell>
      );
    }
    case "def":
      return null;
    default: {
      const t = token as Tokens.Generic;
      return <span key={key}>{t.tokens ? renderTokens(t.tokens) : t.raw}</span>;
    }
  }
}

function renderListItem(item: Tokens.ListItem, key: number): ReactNode {
  // Task items carry a leading checkbox token; render the rest inline after it. A loose item (blank
  // lines between paragraphs) keeps its paragraphs as blocks; a tight one stays inline.
  return (
    <li key={key} className={cn(item.task && "list-none -ml-6 pl-0", item.loose && "space-y-2")}>
      {item.tokens.map((t, i) =>
        t.type === "paragraph" || t.type === "text" ? (
          item.loose && t.type === "paragraph" ? (
            <p key={i} className="leading-relaxed">
              {children(t as Tokens.Paragraph)}
            </p>
          ) : (
            <span key={i}>{children(t as Tokens.Paragraph)}</span>
          )
        ) : (
          renderToken(t, i)
        ),
      )}
    </li>
  );
}

function safeHref(href: string): string | undefined {
  const trimmed = href.trim();
  if (/^(https?:|mailto:|tel:|#|\/)/i.test(trimmed)) return trimmed;
  return undefined;
}
