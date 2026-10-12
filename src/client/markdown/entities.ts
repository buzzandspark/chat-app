/**
 * marked leaves character references in tokens; as React text they'd show literally. Decoded without the DOM,
 * one pass; named ones from a short table rather than shipping the 2,000-entry HTML table.
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
