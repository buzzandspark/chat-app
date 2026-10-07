import { clsx, type ClassValue } from "clsx";

// Conflict-aware class merger replacing tailwind-merge (10 kB gzipped, D21): later classes win within
// a family plus variant prefix; unknown utilities pass through as clsx would.
const FAMILIES: Array<[RegExp, string]> = [
  [/^(?:size)-/, "size"],
  [/^(?:min-h)-/, "min-h"],
  [/^(?:min-w)-/, "min-w"],
  [/^(?:max-h)-/, "max-h"],
  [/^(?:max-w)-/, "max-w"],
  [/^h-/, "h"],
  [/^w-/, "w"],
  [/^rounded-(?:t|b|l|r|tl|tr|bl|br)-/, "rounded-side"],
  [/^rounded(?:-|$)/, "rounded"],
  [/^px-/, "px"],
  [/^py-/, "py"],
  [/^pl-/, "pl"],
  [/^pr-/, "pr"],
  [/^pt-/, "pt"],
  [/^pb-/, "pb"],
  [/^p-/, "p"],
  [/^mx-/, "mx"],
  [/^my-/, "my"],
  [/^m[tblr]-/, "m-side"],
  [/^m-/, "m"],
  [/^gap-/, "gap"],
  [/^opacity-/, "opacity"],
  [/^text-(?:xs|sm|base|lg|xl|\dxl|caption|small|body|title|display|\[)/, "text-size"],
  [/^text-(?:left|center|right|justify)$/, "text-align"],
  [/^font-(?:thin|light|normal|medium|semibold|bold|black)$/, "font-weight"],
  [/^font-(?:sans|mono|heading)$/, "font-family"],
  [/^(?:bg)-/, "bg"],
  [/^(?:text)-/, "text-color"],
  [/^(?:border)-(?:\d|\[)/, "border-width"],
  [/^(?:border)-/, "border-color"],
  [/^(?:justify)-/, "justify"],
  [/^(?:items)-/, "items"],
  [/^(?:flex)-(?:row|col)/, "flex-dir"],
  [/^(?:overflow)-/, "overflow"],
  [/^(?:shadow)(?:-|$)/, "shadow"],
  [/^(?:z)-/, "z"],
  [/^(?:top|bottom|left|right|inset)(?:-|$)/, "inset"],
  [/^(?:translate-x)-/, "translate-x"],
  [/^(?:translate-y)-/, "translate-y"],
  [/^(?:cursor)-/, "cursor"],
  [/^(?:leading)-/, "leading"],
  [/^(?:tracking)-/, "tracking"],
  [/^(?:block|inline|inline-block|flex|inline-flex|grid|hidden|contents)$/, "display"],
  [/^(?:static|fixed|absolute|relative|sticky)$/, "position"],
];

function groupOf(cls: string): string | null {
  // Split variants (`md:hover:` ...) from the utility; `[&_x]:` style variants count as prefix too.
  let i = cls.length;
  let depth = 0;
  for (let k = cls.length - 1; k >= 0; k--) {
    const ch = cls[k];
    if (ch === "]") depth++;
    else if (ch === "[") depth--;
    else if (ch === ":" && depth === 0) {
      i = k;
      break;
    }
  }
  const prefix = i === cls.length ? "" : cls.slice(0, i + 1);
  let util = i === cls.length ? cls : cls.slice(i + 1);
  if (util.startsWith("-")) util = util.slice(1);
  for (const [re, family] of FAMILIES) {
    if (re.test(util)) return `${prefix}${family}`;
  }
  return null;
}

export function cn(...inputs: ClassValue[]): string {
  const joined = clsx(inputs);
  if (!joined) return "";
  const classes = joined.split(/\s+/).filter(Boolean);
  const winners = new Map<string, number>();
  for (let idx = 0; idx < classes.length; idx++) {
    const g = groupOf(classes[idx]!);
    if (g) winners.set(g, idx);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (let idx = 0; idx < classes.length; idx++) {
    const c = classes[idx]!;
    const g = groupOf(c);
    if (g && winners.get(g) !== idx) continue;
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out.join(" ");
}
