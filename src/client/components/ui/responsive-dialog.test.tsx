import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef, useState, type RefObject } from "react";
import { ResponsiveDialog } from "./responsive-dialog";

function Harness({ returnFocus }: { returnFocus?: RefObject<HTMLButtonElement | null> }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button ref={returnFocus}>Show sidebar</button>
      <ResponsiveDialog open={open} onOpenChange={setOpen} title="Search chats" returnFocus={returnFocus}>
        <input aria-label="Query" autoFocus />
      </ResponsiveDialog>
    </>
  );
}

describe("ResponsiveDialog close focus", () => {
  beforeEach(() => {
    // A phone: no hover, below `md`.
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("with no composer to go back to, hands focus to `returnFocus` (a phone search opened from the sidebar)", async () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Harness returnFocus={ref} />);
    await waitFor(() => expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(ref.current));
  });

  it("without `returnFocus`, Radix has no trigger to focus and focus is left on <body>", async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await new Promise((r) => setTimeout(r, 10));
    expect(document.activeElement).toBe(document.body);
  });
});

describe("ResponsiveDialog back gesture", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("takes the back gesture wherever the sidebar isn't docked and leaves history alone where it is", () => {
    const push = vi.spyOn(window.history, "pushState");
    const viewport = (match: (query: string) => boolean) =>
      vi.stubGlobal("matchMedia", (query: string) => ({ matches: match(query), media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    const cases: [string, (query: string) => boolean, number][] = [
      ["portrait phone", () => false, 1],
      ["landscape phone: wide but too short to dock", (q) => q === "(min-width: 768px)", 1],
      ["docked", () => true, 0],
    ];
    for (const [label, match, pushes] of cases) {
      viewport(match);
      render(<Harness />);
      expect(push, label).toHaveBeenCalledTimes(pushes);
      cleanup();
      push.mockClear();
    }
  });
});
