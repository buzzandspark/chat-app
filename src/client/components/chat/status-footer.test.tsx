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

  it("counts down to the automatic retry of a rate-limited reply and offers Try again", () => {
    render(<StatusFooter message={failed("rate_limited")} onRetry={() => {}} onContinue={() => {}} onResume={() => {}} />);
    expect(screen.getByText(/Retrying in/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("after every automatic try, says so and offers no Try again", () => {
    render(<StatusFooter message={{ ...failed("rate_limited"), retryAttempt: 4 }} onRetry={() => {}} onContinue={() => {}} onResume={() => {}} />);
    expect(screen.getByText("Still rate limited after 4 tries.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("keeps the error but offers no retry when a newer turn follows the failed reply", () => {
    const { rerender } = render(<StatusFooter message={failed("rate_limited")} onContinue={() => {}} onResume={() => {}} />);
    expect(screen.getByText("Rate limited.")).toBeInTheDocument();
    expect(screen.queryByText(/Retrying in/)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<StatusFooter message={failed("overloaded")} onContinue={() => {}} onResume={() => {}} />);
    expect(screen.getByText("Claude is overloaded right now.")).toBeInTheDocument();
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
    expect(screen.getByText("These turns were already replaced in another request.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });
});
