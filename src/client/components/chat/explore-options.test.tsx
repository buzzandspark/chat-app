import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CACHE_WARM_MS, type ForkOption } from "@shared/forks";
import { ExploreOptions } from "./explore-options";

const option = (n: number): ForkOption => ({ title: `Option ${n}`, prompt: `Explore ${n}` });
const options = (n: number) => Array.from({ length: n }, (_, i) => option(i + 1));

function setup(props: Partial<Parameters<typeof ExploreOptions>[0]> = {}) {
  const onOpen = vi.fn();
  render(<ExploreOptions options={options(3)} remaining={10} requestedAt={1_000_000} now={1_000_000 + 1000} onOpen={onOpen} {...props} />);
  return { onOpen, button: screen.getByTestId("explore-options") };
}

afterEach(cleanup);

describe("ExploreOptions", () => {
  it("a click opens the sheet, by pointer or keyboard", () => {
    const { onOpen, button } = setup();
    expect(button).toHaveTextContent("Explore 3 options");
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    fireEvent.click(button);
    fireEvent.click(button, { detail: 0 });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("counts only what can still be forked, and does nothing while busy", () => {
    const { onOpen, button } = setup({ options: options(3), remaining: 2, busy: true });
    expect(button).toHaveTextContent("Forking…");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onOpen).not.toHaveBeenCalled();
    cleanup();
    expect(setup({ options: options(3), remaining: 2 }).button).toHaveTextContent("Explore 2 options");
  });

  it("past the cache window the button carries the cache-expired tooltip", () => {
    const fresh = setup();
    expect(fresh.button).not.toHaveAttribute("data-tip");
    cleanup();
    const stale = setup({ now: 1_000_000 + CACHE_WARM_MS + 1 });
    expect(stale.button).toHaveAttribute("data-tip", expect.stringContaining("Cache expired"));
  });
});
