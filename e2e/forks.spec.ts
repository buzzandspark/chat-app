import { expect, test } from "@playwright/test";
import { lastAssistant, openNewChat, runScenario, visible } from "./helpers";

const tabs = (page: import("@playwright/test").Page) => page.locator('[role="tab"]:visible');

async function replyWithOptions(page: import("@playwright/test").Page) {
  await openNewChat(page);
  await runScenario(page, "options_reply");
  await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  const button = visible(page, "explore-options");
  await expect(button).toHaveText(/Explore 3 options/, { timeout: 15_000 });
  return button;
}

test.describe("explore options", () => {
  test("a click forks each option into its own chat with tabs, a divider and the prompt as the first own message", async ({ page }) => {
    const button = await replyWithOptions(page);
    const parentUrl = page.url();
    await button.click();
    await expect(page).not.toHaveURL(parentUrl, { timeout: 15_000 });
    const forkPath = new URL(page.url()).pathname;
    await expect(tabs(page)).toHaveCount(4);
    await expect(tabs(page).nth(0)).toHaveText("Main chat");
    await expect(tabs(page).nth(1)).toHaveText("Keep SQLite");
    await expect(tabs(page).nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(visible(page, "fork-divider")).toContainText("Forked from main chat");
    // The parent's turns sit above the divider; the prompt is the first own message and its reply streams.
    await expect(page.locator('[data-role="user"]:visible')).toHaveCount(2);
    await expect(page.locator('[data-role="user"]:visible').last()).toContainText("keeping SQLite");
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    // No forks of forks.
    await expect(page.getByTestId("explore-options").locator("visible=true")).toHaveCount(0);
    // The sidebar marks the parent and nests the fork under it (rows are found by their own links: the database is shared across projects).
    const parentPath = new URL(parentUrl).pathname;
    const aside = page.locator('aside[aria-label="Chats"]');
    await expect(aside.locator(`a[href="${parentPath}"]`)).toHaveAttribute("aria-label", /^Forked: /);
    await expect(aside.locator(`a[href="${forkPath}"]`)).toHaveText("Keep SQLite");
    // Back on the main chat: no divider, and the options are spent, so the button is gone.
    await tabs(page).nth(0).click();
    await expect(page).toHaveURL(parentUrl);
    await expect(page.getByTestId("fork-divider").locator("visible=true")).toHaveCount(0);
    await expect(tabs(page).nth(0)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("explore-options").locator("visible=true")).toHaveCount(0);
    await page.reload();
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 15_000 });
    await expect(page.getByTestId("explore-options").locator("visible=true")).toHaveCount(0);
    // Elsewhere the forks are not listed.
    await openNewChat(page);
    await expect(aside.locator(`a[href="${forkPath}"]`)).toHaveCount(0);
    await expect(aside.locator(`a[href="${parentPath}"]`)).toHaveCount(1);
  });

  test("press and hold opens the sheet: deselect one, retitle one, rewrite all, fork the rest", async ({ page }) => {
    const button = await replyWithOptions(page);
    const box = (await button.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(900);
    await page.mouse.up();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const instruction = dialog.getByLabel("Instruction for all prompts");
    await expect(instruction).toBeFocused();
    const checks = dialog.getByRole("checkbox");
    await expect(checks).toHaveCount(3);
    await checks.nth(2).uncheck();
    await dialog.getByLabel("Tab title").first().fill("SQLite forever");
    // Enter in the instruction applies it to every prompt; Shift+Enter forks.
    await instruction.fill("Assess performance");
    await instruction.press("Enter");
    await expect(dialog.getByLabel("First message").first()).toHaveValue(/^Assess performance/);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Fork 2 chats" })).toBeEnabled();
    await instruction.press("Shift+Enter");
    await expect(tabs(page)).toHaveCount(3, { timeout: 15_000 });
    await expect(tabs(page).nth(1)).toHaveText("Assess SQLite forever");
    await expect(page.locator('[data-role="user"]:visible').last()).toContainText("Assess performance");
  });

  test("tabs reorder by dragging and the order survives a reload", async ({ page, isMobile }) => {
    test.skip(isMobile, "reordering is a mouse or pen gesture; on touch the strip pans");
    const button = await replyWithOptions(page);
    await button.click();
    await expect(tabs(page)).toHaveCount(4, { timeout: 15_000 });
    const third = (await tabs(page).nth(3).boundingBox())!;
    const first = (await tabs(page).nth(1).boundingBox())!;
    await page.mouse.move(third.x + third.width / 2, third.y + third.height / 2);
    await page.mouse.down();
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2, { steps: 12 });
    await page.mouse.up();
    const reordered = ["Main chat", "Embedded then managed", "Keep SQLite", "Move to Postgres"];
    await expect(tabs(page)).toHaveText(reordered);
    await page.reload();
    await expect(tabs(page)).toHaveText(reordered, { timeout: 15_000 });
  });
});
