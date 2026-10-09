import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InviteForm } from "./invite-form";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: () => {} }) }));

describe("InviteForm on a dead network", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("an invite POST whose fetch rejects says so and frees the button", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    render(<InviteForm token="t" email="ada@example.com" />);
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "correct horse battery" } });
    fireEvent.click(screen.getByRole("button", { name: "Set password and sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Setting the password failed: you seem to be offline.");
    expect(screen.getByRole("button", { name: "Set password and sign in" })).toBeEnabled();
    expect(push).not.toHaveBeenCalled();
  });
});
