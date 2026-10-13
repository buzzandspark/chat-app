// A chat row's full title, shown to the right of the sidebar: one element on <body>, outside the
// sidebar's clipping, moved by the row's own handlers, so hovering never re-renders the list.
let tip: HTMLDivElement | null = null;

export function showRowTip(row: HTMLElement, text: string): void {
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "row-tip";
    tip.setAttribute("aria-hidden", "true");
    document.body.append(tip);
  }
  const rect = row.getBoundingClientRect();
  const edge = row.closest("aside")?.getBoundingClientRect().right ?? rect.right;
  tip.textContent = text;
  tip.style.left = `${edge + 8}px`;
  tip.style.top = `${rect.top + rect.height / 2}px`;
  tip.hidden = false;
}

export function hideRowTip(): void {
  if (tip) tip.hidden = true;
}
