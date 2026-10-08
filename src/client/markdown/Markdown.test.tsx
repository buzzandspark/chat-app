import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

// Highlight requests are recorded and never settle: these tests only ask which code was sent.
const { highlight } = vi.hoisted(() => ({
  highlight: vi.fn<(code: string, lang: string) => Promise<never>>(() => new Promise(() => {})),
}));
vi.mock("./highlight", async (importOriginal) => ({ ...(await importOriginal<object>()), highlight }));

import { Markdown } from "./Markdown";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  highlight.mockClear();
});

describe("Markdown", () => {
  it("renders headings, lists, links, and tables", () => {
    const { container } = render(
      <Markdown
        streaming={false}
        text={
          "# Title\n\nSome **bold** and a [link](https://example.com).\n\n- one\n- two\n\n| a | b |\n|---|--:|\n| 1 | 2 |"
        }
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Title");
    expect(container.querySelector("strong")).toHaveTextContent("bold");
    const link = screen.getByRole("link", { name: "link" });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("rel", "noreferrer");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelectorAll("th")).toHaveLength(2);
    expect(container.querySelectorAll("td")).toHaveLength(2);
    expect(container.querySelectorAll("th")[1]).toHaveClass("text-right");
  });

  it("renders the paragraphs of a loose list item as blocks, not one run-on line", () => {
    const { container } = render(<Markdown streaming={false} text={"- first paragraph\n\n  second paragraph\n\n- next item"} />);
    const items = container.querySelectorAll("li");
    expect(items).toHaveLength(2);
    expect(items[0]!.querySelectorAll("p")).toHaveLength(2);
    expect(items[0]).toHaveClass("space-y-2");
    // A tight list keeps inline content.
    const tight = render(<Markdown streaming={false} text={"- one\n- two"} />).container;
    expect(tight.querySelectorAll("li p")).toHaveLength(0);
  });

  it("renders an unclosed fence as plain monospace without highlight spans", () => {
    const { container } = render(<Markdown streaming text={"```ts\nconst a = 1;\nconst b"} />);
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre).toHaveTextContent("const a = 1;");
    expect(container.querySelector("[data-shiki]")).toBeNull();
    expect(container.querySelector(".markdown-code")).toHaveAttribute("data-closed", "false");
  });

  it("renders a partial table from the rows received so far", () => {
    const { container } = render(<Markdown streaming text={"| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4"} />);
    expect(container.querySelectorAll("th")).toHaveLength(2);
    // The incomplete trailing row is skipped while streaming.
    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
  });

  it("renders the complete rows once streaming has finished", () => {
    const { container } = render(<Markdown streaming={false} text={"| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4"} />);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
  });

  it("renders a table header alone while the delimiter row is still arriving", () => {
    const { container } = render(<Markdown streaming text={"| a | b |\n|---|--"} />);
    expect(container.querySelectorAll("th")).toHaveLength(2);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(0);
  });

  it("never injects raw HTML from the input", () => {
    const { container } = render(
      <Markdown streaming={false} text={'<script>alert(1)</script>\n\nInline <img src=x onerror=alert(1)> here'} />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("drops unsafe link protocols", () => {
    const { container } = render(<Markdown streaming={false} text={"[x](javascript:alert(1))"} />);
    const a = container.querySelector("a");
    expect(a).not.toBeNull();
    expect(a).not.toHaveAttribute("href");
  });

  it("does not re-render finished blocks while the trailing block grows", () => {
    const onBlockRender = vi.fn();
    const { rerender } = render(
      <Markdown streaming text={"first paragraph\n\nsecond paragraph\n\nthird"} onBlockRender={onBlockRender} />,
    );
    const initial = onBlockRender.mock.calls.map((c) => c[0]);
    expect(initial).toEqual(["b0-other", "b1-other", "b2-other"]);
    onBlockRender.mockClear();
    rerender(
      <Markdown
        streaming
        text={"first paragraph\n\nsecond paragraph\n\nthird grows here"}
        onBlockRender={onBlockRender}
      />,
    );
    expect(onBlockRender.mock.calls.map((c) => c[0])).toEqual(["b2-other"]);
  });

  it("keeps a fence nested in a streaming list plain until its closing fence is in", () => {
    vi.useFakeTimers();
    const idle = () => act(() => vi.advanceTimersByTime(3000));
    const code = () => document.querySelector(".markdown-code");
    let text = "1. Install:\n\n   ```bash\n   npm i foo";
    const { rerender } = render(<Markdown streaming text={text} />);
    idle();
    expect(code()).toHaveAttribute("data-closed", "false");
    for (const chunk of [" ba", "r", "\n   ```"]) {
      text += chunk;
      rerender(<Markdown streaming text={text} />);
      idle();
      // The closing fence is the block's last line, so it may still grow; it stays open.
      expect(code()).toHaveAttribute("data-closed", "false");
    }
    expect(highlight).not.toHaveBeenCalled();
    text += "\n2. Next";
    rerender(<Markdown streaming text={text} />);
    idle();
    expect(code()).toHaveAttribute("data-closed", "true");
    expect(highlight.mock.calls).toEqual([["npm i foo bar", "bash"]]);
  });

  it("keeps a fence nested in a streaming blockquote plain, and closes it when the reply ends", () => {
    const { container, rerender } = render(<Markdown streaming text={"> ```ts\n> const a = 1"} />);
    expect(container.querySelector(".markdown-code")).toHaveAttribute("data-closed", "false");
    // marked ends the fence at the end of the quote; once streaming stops that is final.
    rerender(<Markdown streaming={false} text={"> ```ts\n> const a = 1"} />);
    expect(container.querySelector(".markdown-code")).toHaveAttribute("data-closed", "true");
  });

  it("does not close a nested fence on a shorter or different fence line", () => {
    const { container } = render(<Markdown streaming text={"- ````md\n  ```\n  x\n  ~~~~\n- next"} />);
    expect(container.querySelector(".markdown-code")).toHaveAttribute("data-closed", "false");
  });

  it("splits CRLF text into blocks like LF text", () => {
    const onBlockRender = vi.fn();
    const { container } = render(
      <Markdown
        streaming
        text={"intro\r\n\r\n```ts\r\nconst a = 1;\r\n```\r\n\r\n- one\r\n- two\r\n\r\nafter"}
        onBlockRender={onBlockRender}
      />,
    );
    expect(onBlockRender.mock.calls.map((c) => c[0])).toEqual(["b0-other", "b1-fence", "b2-other", "b3-other"]);
    const block = container.querySelector(".markdown-code");
    expect(block).toHaveAttribute("data-closed", "true");
    expect(block!.querySelector("pre")!.textContent).toBe("const a = 1;");
    expect(container.textContent).not.toContain("\r");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });
});
