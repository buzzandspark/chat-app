import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

const codeToTokensWithThemes = vi.fn((code: string) =>
  code.split("\n").map((line) =>
    line.split(" ").flatMap((word, i, arr) => {
      const content = i < arr.length - 1 ? `${word} ` : word;
      return [{ content, offset: 0, variants: { light: { color: "#111" }, dark: { color: "#eee" } } }];
    }),
  ),
);
const loadLanguage = vi.fn(async () => undefined);

vi.mock("shiki/core", () => ({
  createHighlighterCore: vi.fn(async () => ({ codeToTokensWithThemes, loadLanguage })),
}));
vi.mock("shiki/engine/javascript", () => ({ createJavaScriptRegexEngine: vi.fn(() => ({})) }));
vi.mock("shiki/themes/github-light.mjs", () => ({ default: { name: "github-light" } }));
vi.mock("shiki/themes/github-dark.mjs", () => ({ default: { name: "github-dark" } }));
vi.mock("shiki/langs/typescript.mjs", () => ({ default: [{ name: "typescript" }] }));

import { CodeBlock } from "./CodeBlock";

describe("CodeBlock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("renders plain code immediately with a language label and a copy button", () => {
    const { container } = render(<CodeBlock code={"const a = 1;"} lang="ts" closed={false} />);
    expect(container.querySelector("pre")).toHaveTextContent("const a = 1;");
    expect(screen.getByLabelText("Language")).toHaveTextContent("ts");
    const button = screen.getByRole("button", { name: "Copy" });
    expect(button).toHaveClass("touch-target");
    expect(container.querySelector("[data-shiki]")).toBeNull();
  });

  it("copies the code and shows Copied for a moment", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CodeBlock code={"hello"} lang={null} closed={false} />);
    await act(async () => {
      screen.getByRole("button", { name: "Copy" }).click();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("highlights closed code in an idle callback without changing the text", async () => {
    vi.useRealTimers();
    const code = "const a = 1;\nconst b = a + 1;";
    const { container } = render(<CodeBlock code={code} lang="ts" closed />);
    const plainText = container.querySelector("pre")!.textContent;
    expect(plainText).toBe(code);
    await waitFor(() => expect(container.querySelector("[data-shiki]")).not.toBeNull());
    expect(codeToTokensWithThemes).toHaveBeenCalledWith(code, expect.objectContaining({ lang: "typescript" }));
    expect(loadLanguage).toHaveBeenCalled();
    expect(container.querySelector("pre")!.textContent).toBe(plainText);
    expect(container.querySelector(".markdown-code")).toHaveAttribute("data-highlighted", "true");
    const span = container.querySelector<HTMLElement>("[data-shiki]")!;
    expect(span.style.getPropertyValue("--shiki-light")).toBe("#111");
    expect(span.style.getPropertyValue("--shiki-dark")).toBe("#eee");
  });

  it("stays plain for an unknown language", async () => {
    vi.useRealTimers();
    const { container } = render(<CodeBlock code={"x"} lang="brainfuck" closed />);
    await new Promise((r) => setTimeout(r, 120));
    expect(container.querySelector("[data-shiki]")).toBeNull();
    expect(codeToTokensWithThemes).not.toHaveBeenCalled();
  });
});
