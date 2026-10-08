import { expect, test } from "@playwright/test";
import { CHAT_URL, ensureSidebarOpen, lastAssistant, openNewChat, sendText, visible, waitForComposer } from "./helpers";

// ADR-0005: the chat route renders from the client store; the server seeds it.
test.describe("chat route", () => {
  test("the first send does not remount the view", async ({ page }) => {
    await openNewChat(page);
    await visible(page, "composer").evaluate((el) => el.setAttribute("data-token", "before-send"));
    await sendText(page, "no remount please");
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    await expect(page).toHaveURL(CHAT_URL);
    await expect(visible(page, "composer")).toHaveAttribute("data-token", "before-send");
    await expect(page.getByTestId("thread-skeleton")).toHaveCount(0);
  });

  test("per-chat settings survive switching chats and coming back", async ({ page }, info) => {
    const title = `settings ${info.project.name}`;
    await openNewChat(page);
    await sendText(page, title);
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    await page.getByRole("button", { name: "Choose model" }).click();
    await page.getByRole("option", { name: /Claude Haiku 4.5/ }).click();
    await expect(page.getByRole("button", { name: "Choose model" })).toContainText("Haiku 4.5");
    const settingsUrl = page.url();
    await ensureSidebarOpen(page);
    await page.getByRole("link", { name: "New chat" }).click();
    await expect(page).not.toHaveURL(settingsUrl);
    await waitForComposer(page);
    await expect(page.getByRole("button", { name: "Choose model" })).toContainText("Sonnet 5.5");
    await ensureSidebarOpen(page);
    await page.getByRole("complementary", { name: "Chats" }).getByRole("link", { name: title }).click();
    await expect(page).toHaveURL(settingsUrl);
    await expect(page.getByRole("button", { name: "Choose model" })).toContainText("Haiku 4.5");
  });

  test("a refused first send keeps the typed message and the page usable", async ({ page }, info) => {
    await openNewChat(page);
    const path = new URL(page.url()).pathname;
    // Projects share one database within a run: the title must be unique, and the row is found by href.
    const text = `please keep me ${info.project.name}`;
    // A long retry-after keeps the automatic retry out of this test; the manual one is what it exercises.
    await page.route("**/api/chat", (route) =>
      route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "rate_limited", retryAfterMs: 60_000 }) }),
    );
    await sendText(page, text);
    const row = lastAssistant(page);
    await expect(row).toHaveAttribute("data-status", "error", { timeout: 15_000 });
    await expect(row).toContainText("Rate limited");
    await expect(page.locator('[data-role="user"]:visible').last()).toContainText(text);
    // The server refused the chat's only generation, so the sidebar must not list it yet.
    await ensureSidebarOpen(page);
    await expect(page.getByRole("complementary", { name: "Chats" }).locator(`a[href="${path}"]`)).toHaveCount(0);
    // On a phone the open sidebar covers the thread; put it away before pressing Retry.
    const closeSidebar = page.getByRole("button", { name: "Close sidebar" });
    if (await closeSidebar.isVisible()) await closeSidebar.click();
    await page.unroute("**/api/chat");
    await row.getByRole("button", { name: "Try again" }).click();
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    expect(new URL(page.url()).pathname).toBe(path);
    await ensureSidebarOpen(page);
    await expect(page.getByRole("complementary", { name: "Chats" }).locator(`a[href="${path}"]`)).toHaveCount(1);
    await page.reload();
    await waitForComposer(page);
    await expect(page.locator('[data-role="user"]:visible').last()).toContainText(text);
  });

  test("a rate-limited send retries by itself with backoff once the server lets it through", async ({ page }) => {
    await openNewChat(page);
    let refused = 0;
    await page.route("**/api/chat", (route) => {
      refused++;
      void route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "rate_limited", retryAfterMs: 500 }) });
    });
    await sendText(page, "please retry me");
    const row = lastAssistant(page);
    await expect(row).toHaveAttribute("data-status", "error", { timeout: 15_000 });
    await expect(row).toContainText(/Retrying in \d+s \(try 1 of 4\)/);
    // The second automatic try (2 s, then 4 s) is also refused and the footer counts the streak.
    await expect(lastAssistant(page)).toContainText(/try 2 of 4/, { timeout: 15_000 });
    expect(refused).toBeGreaterThanOrEqual(2);
    await page.unroute("**/api/chat");
    // Nobody clicks: the next scheduled try goes through.
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    await expect(page.locator('[data-role="user"]:visible')).toHaveCount(1);
  });

  test("a chat opened from the sidebar renders from memory on a revisit", async ({ page }, info) => {
    const title = `memory ${info.project.name}`;
    await openNewChat(page);
    await sendText(page, title);
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    const url = page.url();
    await ensureSidebarOpen(page);
    await page.getByRole("link", { name: "New chat" }).click();
    await expect(page).not.toHaveURL(url);
    await waitForComposer(page);
    const seeds: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/chats/")) seeds.push(r.url());
    });
    await ensureSidebarOpen(page);
    await page.getByRole("complementary", { name: "Chats" }).getByRole("link", { name: title }).click();
    await expect(page).toHaveURL(url);
    await expect(page.locator('[data-role="user"]:visible').last()).toContainText(title);
    await expect(page.getByTestId("thread-skeleton")).toHaveCount(0);
    expect(seeds.filter((u) => /\/api\/chats\/[0-9a-f-]{36}$/.test(u))).toHaveLength(0);
  });
});
