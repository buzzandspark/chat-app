import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CACHE_WARM_MS, type ForkOption } from "@shared/forks";
import { CLICK_MS, ExploreOptions, HOLD_MS } from "./explore-options";

const option = (n: number): ForkOption => ({ title: `Option ${n}`, prompt: `Explore ${n}` });
const options = (n: number) => Array.from({ length: n }, (_, i) => option(i + 1));

function setup(props: Partial<Parameters<typeof ExploreOptions>[0]> = {}) {
  const onFork = vi.fn();
  const onCustomize = vi.fn();
  render(<ExploreOptions options={options(3)} remaining={10} requestedAt={1_000_000} now={1_000_000 + 1000} onFork={onFork} onCustomize={onCustomize} {...props} />);
  return { onFork, onCustomize, button: screen.getByTestId("explore-options") };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ExploreOptions", () => {
  it("a click forks every option when there are at most five", () => {
    const { onFork, onCustomize, button } = setup();
    expect(button).toHaveTextContent("Explore 3 options");
    fireEvent.pointerDown(button, { button: 0 });
    fireEvent.pointerUp(button);
    expect(onFork).toHaveBeenCalledWith(options(3));
    expect(onCustomize).not.toHaveBeenCalled();
  });

  it("press and hold opens the sheet instead of forking", () => {
    const { onFork, onCustomize, button } = setup();
    fireEvent.pointerDown(button, { button: 0 });
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(onCustomize).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(button);
    expect(onFork).not.toHaveBeenCalled();
  });

  it("a quick release is a click; a release after the click window is abandoned; leaving cancels", () => {
    const { onFork, onCustomize, button } = setup();
    fireEvent.pointerDown(button, { button: 0 });
    act(() => vi.advanceTimersByTime(CLICK_MS / 2));
    fireEvent.pointerLeave(button);
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(onCustomize).not.toHaveBeenCalled();
    expect(onFork).not.toHaveBeenCalled();
    fireEvent.pointerDown(button, { button: 0 });
    act(() => vi.advanceTimersByTime(CLICK_MS + 50));
    fireEvent.pointerUp(button);
    expect(onFork).not.toHaveBeenCalled();
    fireEvent.pointerDown(button, { button: 0 });
    act(() => vi.advanceTimersByTime(CLICK_MS / 2));
    fireEvent.pointerUp(button);
    expect(onFork).toHaveBeenCalledTimes(1);
  });

  it("with more than five options, or more than can still be forked, a click opens the sheet", () => {
    const six = setup({ options: options(6) });
    fireEvent.pointerDown(six.button, { button: 0 });
    fireEvent.pointerUp(six.button);
    expect(six.onCustomize).toHaveBeenCalledTimes(1);
    expect(six.onFork).not.toHaveBeenCalled();
  });

  it("counts only what can still be forked and sends the rest to the sheet", () => {
    const { onFork, onCustomize, button } = setup({ options: options(3), remaining: 2 });
    expect(button).toHaveTextContent("Explore 2 options");
    fireEvent.pointerDown(button, { button: 0 });
    fireEvent.pointerUp(button);
    expect(onCustomize).toHaveBeenCalledTimes(1);
    expect(onFork).not.toHaveBeenCalled();
  });

  it("a keyboard press is a click; with Shift it opens the sheet, by keyboard or pointer", () => {
    const { onFork, onCustomize, button } = setup();
    fireEvent.click(button, { detail: 0 });
    expect(onFork).toHaveBeenCalledTimes(1);
    fireEvent.click(button, { detail: 0, shiftKey: true });
    expect(onCustomize).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(button, { button: 0 });
    fireEvent.pointerUp(button, { shiftKey: true });
    expect(onCustomize).toHaveBeenCalledTimes(2);
    expect(onFork).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Customize options" })).toBeNull();
  });

  it("past the cache window the button carries the cache-expired tooltip", () => {
    const fresh = setup();
    expect(fresh.button).not.toHaveAttribute("data-tip");
    cleanup();
    const stale = setup({ now: 1_000_000 + CACHE_WARM_MS + 1 });
    expect(stale.button).toHaveAttribute("data-tip", expect.stringContaining("Cache expired"));
  });
});
