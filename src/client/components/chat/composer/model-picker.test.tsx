import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ModelPicker } from "./model-picker";

// jsdom has no matchMedia: answer every query with the desktop or the phone layout.
function layout(desktop: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: desktop,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const press = (key: string) => fireEvent.keyDown(document.activeElement ?? document.body, { key });

describe("ModelPicker", () => {
  beforeEach(() => {
    // Radix's popper measures its trigger; jsdom lacks the observer it uses.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("on desktop, opens from the keyboard, arrows to another model and picks it with Enter", async () => {
    layout(true);
    const onChange = vi.fn();
    render(<ModelPicker model="claude-sonnet-5-5" thinking={{ effort: "low" }} onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: "Model: Sonnet 5.5" });
    act(() => trigger.focus());
    press("Enter");

    const sonnet = await screen.findByRole("menuitemradio", { name: /Claude Sonnet 5.5/ });
    expect(sonnet).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(sonnet).toHaveFocus());

    press("ArrowDown");
    const opus = screen.getByRole("menuitemradio", { name: /Claude Opus 5.5/ });
    await waitFor(() => expect(opus).toHaveFocus());
    press("Enter");

    expect(onChange).toHaveBeenCalledWith({ model: "claude-opus-5-5" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("on desktop, picking a model hands focus to the input; Escape returns it to the trigger", async () => {
    layout(true);
    const input = document.body.appendChild(document.createElement("textarea"));
    const focusInput = () => input.focus();
    render(<ModelPicker model="claude-sonnet-5-5" thinking={{ effort: "low" }} onChange={() => {}} onPicked={focusInput} />);
    const trigger = screen.getByRole("button", { name: "Model: Sonnet 5.5" });
    act(() => trigger.focus());
    press("Enter");
    const opus = await screen.findByRole("menuitemradio", { name: /Claude Opus 5.5/ });
    fireEvent.click(opus);
    await waitFor(() => expect(input).toHaveFocus());

    act(() => trigger.focus());
    press("Enter");
    await screen.findByRole("menu");
    press("Escape");
    await waitFor(() => expect(trigger).toHaveFocus());
    input.remove();
  });

  it("on desktop, the effort rows are a radio group the arrows reach after the models, and picking one closes the menu", async () => {
    layout(true);
    const onChange = vi.fn();
    render(<ModelPicker model="claude-haiku-5-5" thinking={{ effort: "low" }} onChange={onChange} />);
    act(() => screen.getByRole("button", { name: "Model: Haiku 5.5" }).focus());
    press("ArrowDown");

    const haiku = await screen.findByRole("menuitemradio", { name: /Claude Haiku 5.5/ });
    expect(haiku).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(screen.getByRole("menuitemradio", { name: /Claude Sonnet 5.5/ })).toHaveFocus());
    for (const name of [/Claude Opus 5.5/, /Claude Haiku 5.5/, /^Low/, /^Medium/]) {
      press("ArrowDown");
      const row = screen.getByRole("menuitemradio", { name });
      await waitFor(() => expect(row).toHaveFocus());
    }
    const group = screen.getByRole("group", { name: "Effort" });
    expect(Array.from(group.querySelectorAll('[role="menuitemradio"]')).map((r) => r.textContent)).toEqual([
      "LowQuick replies, least thinking",
      "MediumBalanced",
      "HighThinks longer before replying",
    ]);
    expect(screen.getByRole("menuitemradio", { name: /^Low/ })).toHaveAttribute("aria-checked", "true");
    press("Enter");
    expect(onChange).toHaveBeenLastCalledWith({ thinking: { effort: "medium" } });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("shows a non-default effort on the trigger", () => {
    layout(true);
    const { rerender } = render(<ModelPicker model="claude-opus-5-5" thinking={{ effort: "medium" }} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Model: Opus 5.5, effort Medium" })).toHaveTextContent("Opus 5.5Medium");
    rerender(<ModelPicker model="claude-opus-5-5" thinking={{ effort: "low" }} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Model: Opus 5.5" })).toHaveTextContent(/^Opus 5.5$/);
  });

  it("on phones, the sheet's models are one radio group the arrows move through, with the effort group apart", async () => {
    layout(false);
    const onChange = vi.fn();
    render(<ModelPicker model="claude-sonnet-5-5" thinking={{ effort: "low" }} onChange={onChange} defaultOpen />);

    const group = await screen.findByRole("radiogroup", { name: "Models" });
    expect(group).not.toContainElement(screen.getByRole("radio", { name: /^Low/ }));
    const radio = (name: RegExp) => screen.getByRole("radio", { name });
    const [sonnet, opus, haiku] = [radio(/Claude Sonnet 5.5/), radio(/Claude Opus 5.5/), radio(/Claude Haiku 5.5/)];
    expect([sonnet, opus, haiku].map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    act(() => sonnet.focus());
    press("ArrowUp");
    expect(haiku).toHaveFocus();
    press("Home");
    expect(sonnet).toHaveFocus();
    fireEvent.click(opus);
    expect(onChange).toHaveBeenCalledWith({ model: "claude-opus-5-5" });
  });

  it("on phones, picking an effort closes the sheet; arrows move within the effort group", async () => {
    layout(false);
    const onChange = vi.fn();
    render(<ModelPicker model="claude-sonnet-5-5" thinking={{ effort: "medium" }} onChange={onChange} defaultOpen />);

    const group = await screen.findByRole("radiogroup", { name: "Effort" });
    const radios = Array.from(group.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
    act(() => radios[1]!.focus());
    press("ArrowDown");
    expect(radios[2]).toHaveFocus();
    press("Home");
    expect(radios[0]).toHaveFocus();
    fireEvent.click(screen.getByRole("radio", { name: /^High/ }));
    expect(onChange).toHaveBeenCalledWith({ thinking: { effort: "high" } });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("on phones, the trigger names the open sheet, and closing it returns focus to the trigger", async () => {
    layout(false);
    render(<ModelPicker model="claude-sonnet-5-5" thinking={{ effort: "low" }} onChange={() => {}} />);
    const trigger = screen.getByRole("button", { name: "Model: Sonnet 5.5" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);

    const dialog = await screen.findByRole("dialog");
    expect(trigger).toHaveAttribute("aria-controls", dialog.id);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    press("Escape");
    await waitFor(() => expect(trigger).toHaveFocus());

    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("radio", { name: /Claude Opus 5.5/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).toHaveFocus();
  });
});
