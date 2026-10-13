// Loaded on a search hit only (search-reveal.ts), so the chat route does not carry it.
/** Ranges over each occurrence of the query's words (case-insensitive) in the row's text. */
function matchRanges(row: Element, query: string): Range[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.toLowerCase() ?? "";
    for (const w of words) {
      for (let at = text.indexOf(w); at !== -1; at = text.indexOf(w, at + w.length)) {
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + w.length);
        ranges.push(range);
      }
    }
  }
  return ranges.sort((a, b) => a.compareBoundaryPoints(Range.START_TO_START, b));
}

/** Centres the first match in the scroller and highlights every match until the next pointer or key press. */
export function showMatch(scroller: HTMLElement, row: Element, query: string): void {
  row.scrollIntoView({ block: "center" });
  const ranges = matchRanges(row, query);
  if (ranges.length === 0) return;
  // A frame later the row has rendered (content-visibility), so the match has a box to centre.
  requestAnimationFrame(() => {
    const box = ranges[0]?.getBoundingClientRect();
    const frame = scroller.getBoundingClientRect();
    if (box && box.height > 0) scroller.scrollTop += box.top - frame.top - (scroller.clientHeight - box.height) / 2;
  });
  if (!("highlights" in CSS)) return;
  CSS.highlights.set("search-hit", new Highlight(...ranges));
  const clear = () => {
    CSS.highlights.delete("search-hit");
    window.removeEventListener("pointerdown", clear, true);
    window.removeEventListener("keydown", clear, true);
  };
  window.addEventListener("pointerdown", clear, true);
  window.addEventListener("keydown", clear, true);
}
