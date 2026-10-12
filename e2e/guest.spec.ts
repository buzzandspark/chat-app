import { expect, test } from "@playwright/test";
import { CHAT_URL, ensureSidebarOpen, lastAssistant, NEW_CHAT_URL, sendText, sidebar, waitForComposer } from "./helpers";

// The harness runs as the dev user without a cookie; /api/guest is where a visitor without a session is sent.
test.describe("guest mode", () => {
  test("a guest chats on Haiku only, and signing in keeps the chat", async ({ page, isMobile }) => {
    await page.goto("/api/guest?next=/c");
    await expect(page).toHaveURL(NEW_CHAT_URL);
    await waitForComposer(page);
    await ensureSidebarOpen(page);
    await expect(sidebar(page).getByText("Guest", { exact: true })).toBeVisible();
    await expect(sidebar(page).getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(sidebar(page).getByRole("button", { name: "Sign out" })).toHaveCount(0);
    if (isMobile) await page.keyboard.press("Escape");

    // Haiku is the model; the others are greyed out.
    await expect(page.getByRole("button", { name: "Choose model" })).toHaveText(/Haiku/);
    if (!isMobile) {
      await page.getByRole("button", { name: "Choose model" }).click();
      await expect(page.getByRole("menuitemradio", { name: /Opus/ })).toHaveAttribute("data-disabled", "");
      await expect(page.getByRole("menuitemradio", { name: /Sonnet/ })).toHaveAttribute("data-disabled", "");
      await expect(page.getByRole("menuitemradio", { name: /Haiku/ })).not.toHaveAttribute("data-disabled", "");
      await page.keyboard.press("Escape");
    }

    // The server refuses another model even if the page asked for one.
    const refused = await page.request.post("/api/chat", {
      data: { generationId: crypto.randomUUID(), chatId: crypto.randomUUID(), messageId: crypto.randomUUID(), assistantMessageId: crypto.randomUUID(), text: "hi", model: "claude-opus-5-5", thinking: { harder: false } },
    });
    expect(refused.status()).toBe(403);

    // The first send gives the chat its address.
    await sendText(page, "guest question");
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    await expect(page).toHaveURL(CHAT_URL);
    const chatPath = new URL(page.url()).pathname;

    // Sign in from the same slot; the chat comes along to the account.
    await ensureSidebarOpen(page);
    await sidebar(page).getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.getByLabel("Email").fill("admin@example.com");
    await page.getByLabel("Password").fill("admin-password-123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(new RegExp(`${chatPath}$`));
    await expect(page.locator('[data-role="user"]:visible').last()).toContainText("guest question");
    await ensureSidebarOpen(page);
    await expect(sidebar(page).locator(`a[href="${chatPath}"]`)).toBeVisible();
    await expect(sidebar(page).getByRole("button", { name: "Sign out" })).toBeVisible();
  });
});
