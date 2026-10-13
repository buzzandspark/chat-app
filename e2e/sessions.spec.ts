import { expect, test } from "@playwright/test";
import { ANY_CHAT_URL, ensureSidebarOpen, lastAssistant, newChatPath, openNewChat, sendText, sidebar, waitForChatUrl, waitForComposer } from "./helpers";

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

  test("a lazy chunk that fails to load costs one control, not the page, and Retry brings it back", async ({ page, isMobile }) => {
    await openNewChat(page);
    await sendText(page, "still here");
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    // The reply's ⋯ menu loads its chunk on first use; with chunks failing it gives way to a Retry.
    await page.route("**/_next/static/chunks/*.js", (route) => route.abort());
    await lastAssistant(page).getByRole("button", { name: "Message actions" }).click();
    const retry = lastAssistant(page).getByRole("button", { name: /didn.t load\. Retry/ });
    await expect(retry).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
    await expect(page.locator('[data-role="user"]:visible').last()).toContainText("still here");
    await expect(page.getByText("This page couldn't be shown")).toHaveCount(0);
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
    // A sidebar row's ⋯ too: its intent lives in the row, outside the boundary, and Retry must clear it.
    await ensureSidebarOpen(page);
    const row = sidebar(page).getByRole("listitem").filter({ has: page.getByRole("link", { name: "still here" }) }).first();
    await row.getByRole("button", { name: "Actions for still here" }).click();
    const rowRetry = row.getByRole("button", { name: /didn.t load\. Retry/ });
    await expect(rowRetry).toBeVisible({ timeout: 10_000 });
    // Once the network is back, Retry restores each control and the next press loads its chunk.
    await page.unroute("**/_next/static/chunks/*.js");
    await rowRetry.click();
    await row.getByRole("button", { name: "Actions for still here" }).click();
    await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    if (isMobile) {
      await page.getByRole("button", { name: "Close sidebar" }).click();
      await expect(sidebar(page)).toHaveAttribute("data-open", "false");
    }
    await retry.click();
    await lastAssistant(page).getByRole("button", { name: "Message actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Copy" })).toBeVisible({ timeout: 15_000 });
  });

  test("an expired or revoked session is sent to sign in and comes back to the same chat", async ({ page, context }) => {
    await context.addCookies([{ name: "better-auth.session_token", value: "stale-token-that-matches-no-session", domain: "127.0.0.1", path: "/" }]);
    const path = newChatPath();
    await page.goto(path);
    await expect(page).toHaveURL(/\/login\?next=/);
    expect(new URL(page.url()).searchParams.get("next")).toBe(path);
    await page.getByLabel("Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await waitForComposer(page);
  });

  test("sign out leaves the session behind and lands on the login page", async ({ page, context }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(ANY_CHAT_URL);
    await waitForComposer(page);
    const before = (await context.cookies()).filter((c) => /session_token/.test(c.name));
    expect(before.length).toBeGreaterThan(0);
    const aside = sidebar(page);
    if ((await aside.getAttribute("data-open")) !== "true") await page.getByRole("button", { name: "Open sidebar" }).click();
    await page.getByTestId("sign-out").click();
    await expect(page).toHaveURL(/\/login/);
    const after = (await context.cookies()).filter((c) => /session_token/.test(c.name) && c.value);
    expect(after).toHaveLength(0);
  });
});
