import { expect, test } from "@playwright/test";
import { ensureSidebarOpen, lastAssistant, newChatPath, openNewChat, sendText, sidebar, waitForComposer, NEW_CHAT_URL } from "./helpers";

// Regression: send in a new chat, click New chat, send again; the second thread went blank and the
// URL stayed /c/new while the reply streamed out of view.
test.describe("new chat", () => {
  test("the first reply in a new chat is announced to screen readers", async ({ page }, info) => {
    // From /c: the first send gives the chat its id in the address.
    await page.goto("/c");
    await waitForComposer(page);
    await sendText(page, `announced chat ${info.project.name}`);
    await expect(page.locator('[aria-live="polite"].sr-only', { hasText: "Reply finished." })).toHaveCount(1, { timeout: 30_000 });
  });

  test("a second New chat in the same session gets its own thread and URL", async ({ page }, info) => {
    // Titles are unique per project: the projects share one database within a run.
    const first = `first chat ${info.project.name}`;
    const second = `second chat ${info.project.name}`;
    await openNewChat(page);
    const firstUrl = page.url();
    await sendText(page, first);
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });

    await ensureSidebarOpen(page);
    await page.getByRole("link", { name: "New chat" }).click();
    // A new chat sits at /c until its first send gives it an id.
    await expect(page).toHaveURL(NEW_CHAT_URL);
    await waitForComposer(page);
    await expect(page.locator("[data-role]:visible")).toHaveCount(0);
    await expect(page.getByTestId("chat-title").locator("visible=true").first()).toHaveText("New chat");

    await sendText(page, second);
    const secondUrl = page.url();
    await expect(page.locator('[data-role="user"]:visible')).toHaveCount(1);
    await expect(page.locator('[data-role="user"]:visible').last()).toContainText(second);
    const row = lastAssistant(page);
    await expect(row).toHaveAttribute("data-status", "streaming");
    // One generation at a time: Stop replaces Send while the reply streams.
    await expect(page.getByRole("button", { name: "Stop generating" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send message" })).toHaveCount(0);
    await expect(row).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    expect(page.url()).toBe(secondUrl);
    await expect(page.locator('[data-role="assistant"]:visible')).toHaveCount(1);
    await expect(page.getByTestId("chat-title").locator("visible=true").first()).toHaveText(second);

    await ensureSidebarOpen(page);
    const aside = sidebar(page);
    await expect(aside.getByRole("link", { name: first })).toBeVisible();
    await expect(aside.getByRole("link", { name: second })).toBeVisible();

    // Going back to the first chat shows its own thread, not the second one's.
    await aside.getByRole("link", { name: first }).click();
    await expect(page).toHaveURL(firstUrl);
    await expect(page.locator('[data-role="user"]:visible').last()).toContainText(first);

    // A third round, from an old chat this time: still its own thread and URL.
    const third = `third chat ${info.project.name}`;
    await ensureSidebarOpen(page);
    await page.getByRole("link", { name: "New chat" }).click();
    await expect(page).not.toHaveURL(firstUrl);
    await expect(page).not.toHaveURL(secondUrl);
    await waitForComposer(page);
    await expect(page.locator("[data-role]:visible")).toHaveCount(0);
    await sendText(page, third);
    await expect(page.locator('[data-role="user"]:visible')).toHaveCount(1);
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    await expect(page.getByTestId("chat-title").locator("visible=true").first()).toHaveText(third);
    await ensureSidebarOpen(page);
    await expect(aside.getByRole("link", { name: third })).toBeVisible();
  });

  test("the root has no landing page: it opens a new chat", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(NEW_CHAT_URL);
    await waitForComposer(page);
  });

  test("/c/new redirects to /c, an empty, usable new chat", async ({ page }) => {
    await page.goto("/c/new");
    await expect(page).toHaveURL(NEW_CHAT_URL);
    await waitForComposer(page);
    await expect(page.locator("[data-role]:visible")).toHaveCount(0);
    await expect(page.getByText(/could not be found/i)).toHaveCount(0);
  });

  test("an id the server has never seen is a new chat, not a 404", async ({ page }) => {
    const path = newChatPath();
    await page.goto(path);
    await waitForComposer(page);
    await expect(page.getByTestId("chat-title").locator("visible=true").first()).toHaveText("New chat");
    await sendText(page, "hello to a fresh id");
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    expect(new URL(page.url()).pathname).toBe(path);
    await page.reload();
    await expect(page.locator('[data-role="user"]:visible').last()).toContainText("hello to a fresh id");
  });
});
