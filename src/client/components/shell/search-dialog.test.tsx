import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchDialog } from "./search-dialog";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }));

const skeletons = () => document.querySelectorAll("#search-hits [data-slot=skeleton]").length;

describe("SearchDialog", () => {
  let respond: (hits: { chatId: string; title: string; snippet: string | null }[]) => void;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise((resolve) => (respond = (hits) => resolve({ ok: true, json: async () => ({ hits }) })))),
    );
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows the skeleton from the keystroke, through the debounce, until that query's results are in", async () => {
    render(<SearchDialog open onOpenChange={() => {}} />);
    const input = screen.getByRole("textbox", { name: "Search chats" });
    fireEvent.change(input, { target: { value: "pin" } });
    expect(skeletons()).toBeGreaterThan(0);
    await act(async () => void vi.advanceTimersByTime(200));
    expect(skeletons()).toBeGreaterThan(0);
    await act(async () => respond([{ chatId: "c1", title: "Pineapple", snippet: null }]));
    expect(skeletons()).toBe(0);
    expect(screen.getByRole("option", { name: "Pineapple" })).toBeInTheDocument();

    // A refinement hides the old hits behind the skeleton until its own results arrive.
    fireEvent.change(input, { target: { value: "pine" } });
    expect(screen.queryByRole("option", { name: "Pineapple" })).toBeNull();
    expect(skeletons()).toBeGreaterThan(0);
    await act(async () => void vi.advanceTimersByTime(200));
    await act(async () => respond([]));
    expect(skeletons()).toBe(0);
    expect(screen.getByText("No matches.")).toBeInTheDocument();
  });
});
