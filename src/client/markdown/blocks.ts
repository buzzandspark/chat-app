/** D9: top-level blocks, fence- and table-aware with lists kept whole, so finished blocks memoise by hash. */

export type BlockKind = "fence" | "table" | "other";

export interface MarkdownBlock {
  /** React key: stable while streaming. */
  key: string;
  /** Memoisation key. */
  hash: string;
  source: string;
  /** False for an unclosed fence and always for the final block, which may still grow. */
  closed: boolean;
  kind: BlockKind;
}

const BLANK = /^[ \t]*$/;
const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const TABLE_DELIM = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const LIST_MARKER = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const INDENTED = /^(?: {4}|\t)/;
const CONTINUATION = /^(?: {2,}|\t)\S/;

/** FNV-1a 32-bit over UTF-16 code units, as 8 hex chars. */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

interface Open {
  char: string;
  len: number;
}

export function splitBlocks(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = markdown.split("\n");
  let cur: string[] = [];
  let kind: BlockKind = "other";
  let fence: Open | null = null;
  let pendingBlanks = 0;

  const flush = (closed: boolean) => {
    if (cur.length === 0) return;
    const source = cur.join("\n");
    const index = blocks.length;
    blocks.push({ key: `b${index}-${kind}`, hash: hashString(source), source, closed, kind });
    cur = [];
    kind = "other";
    pendingBlanks = 0;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (fence) {
      cur.push(line);
      const trimmed = line.trimEnd();
      const m = /^ {0,3}(`+|~+)$/.exec(trimmed);
      if (m && m[1]![0] === fence.char && m[1]!.length >= fence.len) {
        fence = null;
        flush(true);
      }
      continue;
    }

    const open = FENCE_OPEN.exec(line);
    if (open && !(open[2]![0] === "`" && open[3]!.includes("`"))) {
      flush(true);
      cur.push(line);
      kind = "fence";
      fence = { char: open[2]![0]!, len: open[2]!.length };
      continue;
    }

    if (BLANK.test(line)) {
      if (cur.length > 0) pendingBlanks++;
      continue;
    }

    if (cur.length > 0 && pendingBlanks > 0) {
      const first = cur[0]!;
      const continues =
        kind === "other" &&
        ((INDENTED.test(first) && INDENTED.test(line)) ||
          (LIST_MARKER.test(first) && (LIST_MARKER.test(line) || CONTINUATION.test(line))));
      if (continues) {
        for (let b = 0; b < pendingBlanks; b++) cur.push("");
        pendingBlanks = 0;
        cur.push(line);
        continue;
      }
      flush(true);
    }

    if (cur.length === 1 && kind === "other" && line.includes("-") && TABLE_DELIM.test(line) && cur[0]!.includes("|")) {
      kind = "table";
    }
    cur.push(line);
  }

  // The final block can still grow; an open fence is unclosed by definition.
  flush(false);
  return blocks;
}

export function parseFence(source: string, closed: boolean): { lang: string | null; code: string } {
  const nl = source.indexOf("\n");
  const opener = nl === -1 ? source : source.slice(0, nl);
  const m = FENCE_OPEN.exec(opener);
  const info = (m?.[3] ?? "").trim();
  const lang = info ? info.split(/\s+/)[0]!.toLowerCase() : null;
  if (nl === -1) return { lang, code: "" };
  let body = source.slice(nl + 1);
  if (closed) {
    const last = body.lastIndexOf("\n");
    body = last === -1 ? "" : body.slice(0, last);
  }
  return { lang, code: body };
}
