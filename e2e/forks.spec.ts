import { expect, test, type Page } from "@playwright/test";
import { lastAssistant, openNewChat, runScenario, sendText, visible } from "./helpers";

const tabs = (page: Page) => page.locator('[role="tab"]:visible');

async function replyWithOptions(page: Page) {
  await openNewChat(page);
  await runScenario(page, "options_reply");
  await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  const button = visible(page, "explore-options");
  await expect(button).toHaveText(/Explore 3 options/, { timeout: 15_000 });
  return button;
}

/** The button is up only while the last reply has options this chat can fork; otherwise it is tucked behind the composer. */
async function expectExploreHidden(page: Page) {
  await expect(page.getByTestId("explore-options").locator("visible=true")).toHaveCount(0, { timeout: 15_000 });
}

/** The sheet is the default: a click opens it with every option picked; its button forks them. */
async function forkAll(page: Page) {
  await visible(page, "explore-options").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /^Start \d+ chats?$/ }).click();
  // Its exit animation would catch raw mouse events meant for the tabs.
  await expect(dialog).toBeHidden();
}

test.describe("explore options", () => {
  test("a reply's ⋯ duplicates the chat up to that reply as a new fork tab", async ({ page }, info) => {
    const title = `duplicate me ${info.project.name}`;
    await openNewChat(page);
    await sendText(page, title);
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    const parentUrl = page.url();
    await lastAssistant(page).getByRole("button", { name: "Message actions" }).click();
    const item = page.getByRole("menuitem", { name: "Copy from here" });
    expect(await item.evaluate((el) => getComputedStyle(el).cursor)).toBe("pointer");
    await item.click();
    await expect(page).not.toHaveURL(parentUrl, { timeout: 15_000 });
    await expect(tabs(page)).toHaveText(["Main chat", `${title} (copy)`]);
    await expect(tabs(page).nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('[data-role="user"]:visible')).toHaveCount(1);
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done");
  });

  test("forking from the sheet puts each option in its own chat with tabs, a divider and the prompt as the first own message", async ({ page }) => {
    await replyWithOptions(page);
    const parentUrl = page.url();
    await forkAll(page);
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
    await expectExploreHidden(page);
    // Rows are found by href: the database is shared across projects.
    const parentPath = new URL(parentUrl).pathname;
    const aside = page.locator('aside[aria-label="Chats"]');
    await expect(aside.locator(`a[href="${parentPath}"]`)).toHaveAttribute("aria-label", /, has forks$/);
    await expect(aside.locator(`a[href="${forkPath}"]`)).toHaveText("Keep SQLite");
    await tabs(page).nth(2).click();
    await expect(tabs(page).nth(2)).toHaveAttribute("aria-selected", "true", { timeout: 15_000 });
    await expect(page.locator('[data-role="user"]:visible').last()).toContainText("moving to Postgres");
    // Back on the main chat: no divider, and the options are spent, so the button is gone.
    await tabs(page).nth(0).click();
    await expect(page).toHaveURL(parentUrl);
    await expect(page.getByTestId("fork-divider").locator("visible=true")).toHaveCount(0);
    await expect(tabs(page).nth(0)).toHaveAttribute("aria-selected", "true");
    await expectExploreHidden(page);
    await page.reload();
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 15_000 });
    await expectExploreHidden(page);
    // Elsewhere the forks are not listed.
    await openNewChat(page);
    await expect(aside.locator(`a[href="${forkPath}"]`)).toHaveCount(0);
    await expect(aside.locator(`a[href="${parentPath}"]`)).toHaveCount(1);
  });

  test("the sheet: deselect one, retitle one, rewrite all with Enter, fork the rest with Shift+Enter", async ({ page, isMobile }) => {
    const button = await replyWithOptions(page);
    await button.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const instruction = dialog.getByLabel("Change every first message");
    // A phone opens without focusing a field, so its keyboard stays down.
    if (isMobile) await expect(instruction).not.toBeFocused();
    else await expect(instruction).toBeFocused();
    const checks = dialog.getByRole("checkbox");
    await expect(checks).toHaveCount(3);
    await checks.nth(2).uncheck();
    // A press on an option outside its fields toggles it too.
    const second = dialog.getByTestId("fork-sheet-options").getByRole("listitem").nth(1);
    await second.click({ position: { x: 4, y: 4 } });
    await expect(checks.nth(1)).not.toBeChecked();
    await second.click({ position: { x: 4, y: 4 } });
    await expect(checks.nth(1)).toBeChecked();
    await dialog.getByLabel("Tab title").first().fill("SQLite forever");
    // Enter in the instruction applies it to every prompt; Shift+Enter forks.
    await instruction.fill("Assess performance");
    await instruction.press("Enter");
    await expect(dialog.getByLabel("First message").first()).toHaveValue(/^Assess performance/);
    await expect(instruction).toHaveValue("");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Start 2 chats" })).toBeEnabled();
    await instruction.press("Shift+Enter");
    await expect(tabs(page)).toHaveCount(3, { timeout: 15_000 });
    await expect(tabs(page).nth(1)).toHaveText("SQLite forever");
    await expect(page.locator('[data-role="user"]:visible').last()).toContainText("Assess performance");
  });

  test("tabs close and reopen from the sidebar, cycle with Ctrl+Shift+brackets, and a right-click menu deletes or declares a winner", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard and right-click are desktop gestures");
    await replyWithOptions(page);
    const parentUrl = page.url();
    await forkAll(page);
    await expect(tabs(page)).toHaveCount(4, { timeout: 15_000 });
    // Close a tab: it leaves the strip and stays out across a reload; opening its chat from the sidebar brings it back.
    await page.getByRole("button", { name: "Close tab Move to Postgres" }).click();
    await expect(tabs(page)).toHaveText(["Main chat", "Keep SQLite", "Embedded then managed"]);
    await page.reload();
    await expect(tabs(page)).toHaveText(["Main chat", "Keep SQLite", "Embedded then managed"], { timeout: 15_000 });
    await page.locator('aside[aria-label="Chats"]').getByRole("link", { name: "Move to Postgres" }).click();
    await expect(tabs(page)).toHaveText(["Main chat", "Keep SQLite", "Move to Postgres", "Embedded then managed"], { timeout: 15_000 });
    await expect(tabs(page).nth(2)).toHaveAttribute("aria-selected", "true");
    // Ctrl+Shift+] moves to the next tab, [ back; both wrap.
    await page.keyboard.press("Control+Shift+BracketRight");
    await expect(tabs(page).nth(3)).toHaveAttribute("aria-selected", "true", { timeout: 15_000 });
    await page.keyboard.press("Control+Shift+BracketRight");
    await expect(page).toHaveURL(parentUrl, { timeout: 15_000 });
    await page.keyboard.press("Control+Shift+BracketLeft");
    await expect(tabs(page).nth(3)).toHaveAttribute("aria-selected", "true", { timeout: 15_000 });
    // Right-click: Delete chat removes another tab after a confirmation.
    await tabs(page).nth(1).click();
    await expect(tabs(page).nth(1)).toHaveAttribute("aria-selected", "true", { timeout: 15_000 });
    await tabs(page).nth(3).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete chat" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(tabs(page)).toHaveText(["Main chat", "Keep SQLite", "Move to Postgres"]);
    // Right-click: Declare winner keeps that chat alone, with its history, and opens it since this one is deleted.
    const loserPath = new URL(page.url()).pathname;
    const parentPath = new URL(parentUrl).pathname;
    await tabs(page).nth(2).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Declare winner" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Declare winner" }).click();
    await expect(page).not.toHaveURL(loserPath, { timeout: 15_000 });
    const winnerPath = new URL(page.url()).pathname;
    await expect(page.locator('[data-role="user"]:visible').last()).toContainText("moving to Postgres", { timeout: 15_000 });
    await expect(tabs(page)).toHaveCount(0);
    await expect(page.getByTestId("fork-divider").locator("visible=true")).toHaveCount(0);
    await expect(page.locator('[data-role="user"]:visible')).toHaveCount(2);
    // Rows are found by their own links: the database is shared across the run's tests.
    const aside = page.locator('aside[aria-label="Chats"]');
    await expect(aside.locator(`a[href="${winnerPath}"]`)).toHaveText("Move to Postgres");
    await expect(aside.locator(`a[href="${loserPath}"]`)).toHaveCount(0);
    await expect(aside.locator(`a[href="${parentPath}"]`)).toHaveCount(0);
  });

  test("Delete forks on the main tab removes every fork and keeps the main chat", async ({ page, isMobile }) => {
    test.skip(isMobile, "right-click is a desktop gesture");
    await replyWithOptions(page);
    const parentUrl = page.url();
    await forkAll(page);
    await expect(tabs(page)).toHaveCount(4, { timeout: 15_000 });
    const forkPath = new URL(page.url()).pathname;
    await tabs(page).nth(0).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete forks" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete forks" }).click();
    // The viewed fork was deleted, so the main chat opens, alone.
    await expect(page).toHaveURL(parentUrl, { timeout: 15_000 });
    await expect(tabs(page)).toHaveCount(0);
    const aside = page.locator('aside[aria-label="Chats"]');
    await expect(aside.locator(`a[href="${forkPath}"]`)).toHaveCount(0);
    await expect(aside.locator(`a[href="${new URL(parentUrl).pathname}"]`)).toHaveCount(1);
    await expectExploreHidden(page);
  });

  test("the button pops up only once the count says there are options, and a click before the options finish waits for them", async ({ page }) => {
    await openNewChat(page);
    await expectExploreHidden(page);
    await runScenario(page, "options_reply");
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    // The count arrives about 0.4 s in; the full list about 1.5 s after that.
    const button = visible(page, "explore-options");
    await expect(button).toHaveText(/Explore 3 options/, { timeout: 10_000 });
    await expect(button).toHaveAttribute("data-state", "ready");
    await button.click();
    await expect(button).toHaveAttribute("data-state", "awaiting");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByRole("checkbox")).toHaveCount(3);
  });
});
