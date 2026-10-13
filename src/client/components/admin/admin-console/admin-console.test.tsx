import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AdminUserRow } from "@server/admin";
import { AdminConsole } from ".";

const ada: AdminUserRow = {
  id: "u1",
  email: "ada@example.com",
  name: "Ada",
  role: "user",
  banned: false,
  costCapUsd: 5,
  costSpentUsd: 0,
  lastActiveAt: null,
  createdAt: 1,
  invite: null,
};

const offline = () => Promise.reject(new TypeError("Failed to fetch"));

function renderConsole() {
  render(<AdminConsole initialUsers={[ada]} selfId="admin" defaultCapUsd={5} initialGuestsBlocked={false} />);
}

describe("AdminConsole on a dead network", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("a create whose fetch rejects says so and frees the form", async () => {
    vi.stubGlobal("fetch", vi.fn(offline));
    renderConsole();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Create and invite" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("You're offline. Try again when you're connected.");
    expect(screen.getByRole("button", { name: "Create and invite" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Issue invite" })).toBeEnabled();
  });

  it("a Block guests switch whose save fails turns back off and says so", async () => {
    vi.stubGlobal("fetch", vi.fn(offline));
    renderConsole();
    fireEvent.click(screen.getByRole("switch", { name: "Block guests" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't change guest access. Try again.");
    expect(screen.getByRole("switch", { name: "Block guests" })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Block guests" })).toBeEnabled();
  });

  it("a row action whose fetch rejects says so and frees every action", async () => {
    vi.stubGlobal("fetch", vi.fn(offline));
    renderConsole();
    fireEvent.click(screen.getByRole("button", { name: "Issue invite" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("You're offline. Try again when you're connected.");
    expect(screen.getByRole("button", { name: "Issue invite" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Disable" })).toBeEnabled();
  });

  it("a refresh that rejects after a create keeps the invite and the list", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      init?.method === "POST" ? Promise.resolve(Response.json({ inviteUrl: "http://x/invite/t" })) : offline(),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderConsole();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Create and invite" }));

    expect(await screen.findByTestId("invite-url")).toHaveTextContent("http://x/invite/t");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/users"));
    // The rejected refresh must not escape as an unhandled rejection (vitest fails the run on one).
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByTestId("user-ada@example.com")).toBeInTheDocument();
  });
});
