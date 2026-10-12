/** Top-level blocks, fence- and table-aware with lists kept whole, so finished blocks memoise by hash. */

type BlockKind = "fence" | "table" | "other";

export interface MarkdownBlock {
  /** React key: stable while streaming. */
  key: string;
  hash: string;
  source: string;
  /** False for an unclosed fence and always for the final block, which may still grow. */
  closed: boolean;
  kind: BlockKind;
  /** Character offset of the block's first line in the whole text (for incremental re-splitting). */
  start: number;
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
  /** The fence is indented inside a list item: it belongs to the list block, which marked renders whole. */
  inList: boolean;
}

/** Splits from `base` (a character offset at a block boundary); `startIndex` numbers the blocks that follow. */
function splitFrom(markdown: string, base: number, startIndex: number): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = markdown.split("\n");
  let cur: string[] = [];
  let curStart = 0;
  let kind: BlockKind = "other";
  // Any line, not just the first: Claude often leads a list with a label line (`**Steps:**` then `1. Install:`).
  let listed = false;
  let fence: Open | null = null;
  let pendingBlanks = 0;
  let offset = 0;

  const flush = (closed: boolean) => {
    if (cur.length === 0) return;
    const source = cur.join("\n");
    const index = startIndex + blocks.length;
    blocks.push({ key: `b${index}-${kind}`, hash: hashString(source), source, closed, kind, start: base + curStart });
    cur = [];
    kind = "other";
    listed = false;
    pendingBlanks = 0;
  };
  const push = (line: string, at: number) => {
    if (cur.length === 0) curStart = at;
    if (LIST_MARKER.test(line)) listed = true;
    cur.push(line);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineStart = offset;
    offset += line.length + 1;

    if (fence) {
      cur.push(line);
      const trimmed = line.trimEnd();
      // A fence inside a list item closes at the item's indent; a top-level one within 3 spaces.
      const m = (fence.inList ? /^\s*(`+|~+)$/ : /^ {0,3}(`+|~+)$/).exec(trimmed);
      if (m && m[1]![0] === fence.char && m[1]!.length >= fence.len) {
        const inList = fence.inList;
        fence = null;
        if (!inList) flush(true); // in a list the item (and the list) keeps collecting
      }
      continue;
    }

    const open = FENCE_OPEN.exec(line);
    if (open && !(open[2]![0] === "`" && open[3]!.includes("`"))) {
      // An indented fence after a list marker stays in the list block so marked nests it and Copy drops the
      // indent; if it isn't really a list (`1990. was` continuing a paragraph), marked still renders it right.
      const inList = cur.length > 0 && kind === "other" && listed && open[1]!.length > 0;
      if (!inList) {
        flush(true);
        kind = "fence";
      } else {
        for (let b = 0; b < pendingBlanks; b++) cur.push("");
        pendingBlanks = 0;
      }
      push(line, lineStart);
      fence = { char: open[2]![0]!, len: open[2]!.length, inList };
      continue;
    }

    if (BLANK.test(line)) {
      if (cur.length > 0) pendingBlanks++;
      continue;
    }

    if (cur.length > 0 && pendingBlanks > 0) {
      const continues =
        kind === "other" &&
        ((INDENTED.test(cur[0]!) && INDENTED.test(line)) ||
          (listed && (LIST_MARKER.test(line) || CONTINUATION.test(line))));
      if (continues) {
        for (let b = 0; b < pendingBlanks; b++) cur.push("");
        pendingBlanks = 0;
        push(line, lineStart);
        continue;
      }
      flush(true);
    }

    if (cur.length === 1 && kind === "other" && line.includes("-") && TABLE_DELIM.test(line) && cur[0]!.includes("|")) {
      kind = "table";
    }
    push(line, lineStart);
  }

  // The final block can still grow; an open fence is unclosed by definition.
  flush(false);
  return blocks;
}

export function splitBlocks(markdown: string): MarkdownBlock[] {
  return splitFrom(markdown, 0, 0);
}

// While streaming only the tail is re-split; the cache lives here, not in React state, so rendering stays pure.
// A last block of one unfinished line (`2` before its `.`) may rejoin the list before it, so that block is re-split too.
const RECENT = 8;
const recent: Array<{ text: string; blocks: MarkdownBlock[] }> = [];

export function splitBlocksIncremental(markdown: string): MarkdownBlock[] {
  let result: MarkdownBlock[] | null = null;
  for (let i = recent.length - 1; i >= 0; i--) {
    const entry = recent[i]!;
    if (entry.text === markdown) {
      result = entry.blocks;
      break;
    }
    if (entry.blocks.length > 1 && markdown.length > entry.text.length && markdown.startsWith(entry.text)) {
      let keep = entry.blocks.length - 1;
      if (!entry.text.includes("\n", entry.blocks[keep]!.start)) keep--;
      const stable = entry.blocks.slice(0, keep);
      const tailStart = entry.blocks[keep]!.start;
      result = stable.concat(splitFrom(markdown.slice(tailStart), tailStart, stable.length));
      break;
    }
  }
  if (!result) result = splitFrom(markdown, 0, 0);
  recent.push({ text: markdown, blocks: result });
  if (recent.length > RECENT) recent.shift();
  return result;
}

export function parseFence(source: string, closed: boolean): { lang: string | null; code: string } {
  const nl = source.indexOf("\n");
  const opener = nl === -1 ? source : source.slice(0, nl);
  const m = FENCE_OPEN.exec(opener);
  const info = (m?.[3] ?? "").trim();
  const lang = info ? info.split(/\s+/)[0]!.toLowerCase() : null;
  if (nl === -1) return { lang, code: "" };
  let body = source.slice(nl + 1);
  // CommonMark: an opener indented N spaces (after a paragraph, say) strips up to N from each line,
  // so the code and its Copy don't carry the indent.
  const indent = m?.[1]?.length ?? 0;
  if (indent > 0) body = body.replace(new RegExp(`^ {1,${indent}}`, "gm"), "");
  if (closed) {
    const last = body.lastIndexOf("\n");
    body = last === -1 ? "" : body.slice(0, last);
  }
  return { lang, code: body };
}
