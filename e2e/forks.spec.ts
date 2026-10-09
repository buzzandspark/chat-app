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
    await expect(page.locator('aside[aria-label="Chats"] a', { hasText: "Keep SQLite" })).toHaveCount(1);
    // Back on the main chat the parent's own rows carry no divider.
    await tabs(page).nth(0).click();
    await expect(page).toHaveURL(parentUrl);
    await expect(page.getByTestId("fork-divider").locator("visible=true")).toHaveCount(0);
    await expect(tabs(page).nth(0)).toHaveAttribute("aria-selected", "true");
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
    const checks = dialog.getByRole("checkbox");
    await expect(checks).toHaveCount(3);
    await checks.nth(2).uncheck();
    await dialog.getByLabel("Tab title").first().fill("SQLite forever");
    await dialog.getByLabel("Instruction for all prompts").fill("Assess performance");
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(dialog.getByLabel("First message").first()).toHaveValue(/^Assess performance/);
    await dialog.getByRole("button", { name: "Fork 2 chats" }).click();
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
