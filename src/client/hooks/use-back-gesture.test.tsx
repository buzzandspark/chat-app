import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBackGesture } from "./use-back-gesture";

function Sheet({ open }: { open: boolean }) {
  useBackGesture(open, () => {});
  return null;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useBackGesture", () => {
  it("takes the back gesture whenever its caller says the sheet is open, at any width (a landscape phone's sidebar)", () => {
    const push = vi.spyOn(window.history, "pushState");
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    render(<Sheet open />);
    expect(push).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("leaves history alone while closed", () => {
    const push = vi.spyOn(window.history, "pushState");
    render(<Sheet open={false} />);
    expect(push).not.toHaveBeenCalled();
  });
});
