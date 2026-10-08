/**
 * marked leaves character references in its tokens for its HTML renderer to emit and the browser to
 * decode; rendered as React text they would show literally (`AT&amp;T`). This decodes them without
 * the DOM, so server and client render the same text. One pass, so `&amp;lt;` stays `&lt;`.
 * Numeric references follow CommonMark (NUL, surrogates and out-of-range code points become U+FFFD);
 * named ones come from a short table of what replies actually use, and an unknown name stays as typed
 * rather than pulling the 2,000-entry HTML table into the chat route's bundle.
 */
const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  copy: "©", reg: "®", trade: "™", mdash: "—", ndash: "–", hellip: "…",
  laquo: "«", raquo: "»", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  times: "×", divide: "÷", minus: "−", plusmn: "±", le: "≤", ge: "≥", ne: "≠",
  deg: "°", middot: "·", bull: "•", larr: "←", rarr: "→",
  euro: "€", pound: "£", yen: "¥", cent: "¢", sect: "§", para: "¶",
};

const REFERENCE = /&(?:#(\d{1,7})|#[xX]([\da-fA-F]{1,6})|([A-Za-z][A-Za-z\d]{1,31}));/g;

export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(REFERENCE, (ref, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    // hasOwn, not `in`: `&constructor;` must not find Object.prototype.
    if (name !== undefined) return Object.hasOwn(NAMED, name) ? NAMED[name]! : ref;
    const cp = dec !== undefined ? Number.parseInt(dec, 10) : Number.parseInt(hex!, 16);
    return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? "�" : String.fromCodePoint(cp);
  });
}
