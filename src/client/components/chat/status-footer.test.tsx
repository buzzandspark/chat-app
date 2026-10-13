import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createMessageState } from "@client/store/chat-store";

vi.mock("@client/hooks/use-new-chat", () => ({ useNewChat: () => () => {} }));

import { StatusFooter } from "./status-footer";

const failed = (kind: "rate_limited" | "overloaded") =>
  createMessageState({
    id: "a1",
    chatId: "c1",
    role: "assistant",
    status: "error",
    error: { kind, message: kind, retryable: true, retryAfterMs: 1000 },
    local: true,
  });

describe("StatusFooter", () => {
  afterEach(cleanup);

  it("counts down to the automatic retry of a rate-limited reply and offers Retry", () => {
    render(<StatusFooter message={failed("rate_limited")} onRetry={() => {}} onContinue={() => {}} onResume={() => {}} />);
    expect(screen.getByText(/Retrying in/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("shows a wait over two minutes with Retry and no countdown", () => {
    const message = failed("rate_limited");
    render(<StatusFooter message={{ ...message, error: { ...message.error!, retryAfterMs: 20 * 60_000 } }} onRetry={() => {}} onContinue={() => {}} onResume={() => {}} />);
    expect(screen.getByText(/Busy right now\. Try again in/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText(/Retrying in/)).toBeNull();
  });

  it("after every automatic try, says so and offers no Retry", () => {
    render(<StatusFooter message={{ ...failed("rate_limited"), retryAttempt: 4 }} onRetry={() => {}} onContinue={() => {}} onResume={() => {}} />);
    expect(screen.getByText("Still rate limited. Try again later.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("keeps the error but offers no retry when a newer turn follows the failed reply", () => {
    const { rerender } = render(<StatusFooter message={failed("rate_limited")} onContinue={() => {}} onResume={() => {}} />);
    expect(screen.getByText("Rate limited.")).toBeInTheDocument();
    expect(screen.queryByText(/Retrying in/)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<StatusFooter message={failed("overloaded")} onContinue={() => {}} onResume={() => {}} />);
    expect(screen.getByText("Claude is overloaded.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers Reload, not Retry, for a replace another request already made", () => {
    const message = createMessageState({
      id: "a1",
      chatId: "c1",
      role: "assistant",
      status: "error",
      error: { kind: "conflict", message: "", retryable: false, status: 409 },
      local: true,
    });
    render(<StatusFooter message={message} onRetry={() => {}} onContinue={() => {}} onResume={() => {}} />);
    expect(screen.getByText("This chat has changed since you opened it.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });

  it("shows plain text, never the server's, and offers Retry only when it can help", () => {
    const failedWith = (error: { kind: "bad_request" | "network" | "offline"; message: string; retryable: boolean }) =>
      createMessageState({ id: "a1", chatId: "c1", role: "assistant", status: "error", error, local: true });
    const { rerender, container } = render(
      <StatusFooter message={failedWith({ kind: "bad_request", message: "messages.0: raw upstream text", retryable: false })} onRetry={() => {}} onContinue={() => {}} onResume={() => {}} />,
    );
    expect(screen.getByText("Something went wrong.")).toBeInTheDocument();
    expect(screen.queryByText(/raw upstream/)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<StatusFooter message={failedWith({ kind: "network", message: "", retryable: true })} onRetry={() => {}} onContinue={() => {}} onResume={() => {}} />);
    expect(screen.getByText("Lost the connection to Claude.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(container.querySelector("svg.lucide-wifi-off")).toBeNull();
    rerender(<StatusFooter message={failedWith({ kind: "offline", message: "", retryable: true })} onRetry={() => {}} onContinue={() => {}} onResume={() => {}} />);
    expect(screen.getByText("Couldn't send this message.")).toBeInTheDocument();
    expect(container.querySelector("svg.lucide-wifi-off")).not.toBeNull();
  });
});
