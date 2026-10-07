import { expect, test } from "@playwright/test";
import { CHAT_URL, ensureSidebarOpen, lastAssistant, openNewChat, sendText, waitForChatUrl, waitForComposer } from "./helpers";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "admin-password-123";

test.describe("sessions and errors", () => {
  test("a restored draft leaves Send enabled and sendable", async ({ page }) => {
    await openNewChat(page);
    await sendText(page, "draft anchor");
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    await waitForChatUrl(page);
    await page.getByRole("textbox", { name: "Message" }).fill("unsent after reload");
    await page.waitForTimeout(400);
    await page.reload();
    await waitForComposer(page);
    await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue("unsent after reload");
    const send = page.getByRole("button", { name: "Send message" });
    await expect(send).toBeEnabled();
    await send.click();
    await expect(page.locator('[data-role="user"]:visible').last()).toContainText("unsent after reload");
  });

  test("a lazy chunk that fails to load costs one control, not the page", async ({ page }) => {
    await openNewChat(page);
    await sendText(page, "still here");
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    await ensureSidebarOpen(page);
    await page.route("**/_next/static/chunks/*.js", (route) => route.abort());
    await page.getByRole("button", { name: "Search chats" }).first().click();
    await page.waitForTimeout(800);
    await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
    await expect(page.locator('[data-role="user"]:visible').last()).toContainText("still here");
    await expect(page.getByText("This chat could not be shown")).toHaveCount(0);
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
    await page.unroute("**/_next/static/chunks/*.js");
    // Once the network is back, the next open loads the chunk instead of replaying the cached failure.
    await page.getByRole("button", { name: "Search chats" }).first().click();
    await expect(page.getByRole("textbox", { name: /search/i })).toBeVisible({ timeout: 15_000 });
  });

  test("sign out leaves the session behind and lands on the login page", async ({ page, context }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(CHAT_URL);
    await waitForComposer(page);
    const before = (await context.cookies()).filter((c) => /session_token/.test(c.name));
    expect(before.length).toBeGreaterThan(0);
    const aside = page.getByRole("complementary", { name: "Chats" });
    if ((await aside.getAttribute("data-open")) !== "true") await page.getByRole("button", { name: "Show sidebar" }).click();
    await page.getByTestId("sign-out").click();
    await expect(page).toHaveURL(/\/login/);
    const after = (await context.cookies()).filter((c) => /session_token/.test(c.name) && c.value);
    expect(after).toHaveLength(0);
  });
});
