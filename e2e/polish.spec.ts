import { expect, test } from "@playwright/test";
import { CHAT_URL, assistantText, ensureSidebarOpen, lastAssistant, openNewChat, runScenario, sendText, sidebar, waitForChatUrl } from "./helpers";

test.describe("edit, regenerate, drafts", () => {
  test("editing the last message replaces it and regenerates", async ({ page }) => {
    await openNewChat(page);
    await sendText(page, "first version");
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    await page.locator('[data-role="user"]:visible').last().getByRole("button", { name: "Message actions" }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    await expect(page.getByRole("menu")).toBeHidden();
    const box = page.getByRole("textbox", { name: "Message" });
    await expect(box).toHaveValue("first version");
    await box.fill("second version");
    await page.getByRole("button", { name: "Send edited message" }).click();
    await expect(page.locator('[data-role="user"]:visible')).toHaveCount(1);
    await expect(page.locator('[data-role="user"]:visible').last()).toContainText("second version");
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    await waitForChatUrl(page);
    await page.reload();
    await expect(page.locator('[data-role="user"]:visible')).toHaveCount(1);
    await expect(page.locator('[data-role="user"]:visible').last()).toContainText("second version");
    await expect(page.locator('[data-role="assistant"]')).toHaveCount(1);
  });

  test("regenerate replaces the reply on the server too", async ({ page }) => {
    await openNewChat(page);
    await runScenario(page, "max_tokens");
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    await lastAssistant(page).getByRole("button", { name: "Message actions" }).click();
    await page.getByRole("menuitem", { name: "Regenerate" }).click();
    await expect(page.getByRole("menu")).toBeHidden();
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    await waitForChatUrl(page);
    await page.reload();
    await expect(page.locator('[data-role="assistant"]')).toHaveCount(1);
  });

  test("a draft typed in a brand-new chat survives a reload", async ({ page }) => {
    // The URL is the chat's own id from the start (ADR-0005), so the draft has a key before any send.
    await openNewChat(page);
    await page.getByRole("textbox", { name: "Message" }).fill("unsent draft text");
    await page.waitForTimeout(400);
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue("unsent draft text");
    await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
  });
});

test.describe("chat management", () => {
  test("pin moves a chat under a Pinned heading and unpin moves it back", async ({ page }, info) => {
    const title = `pin me ${info.project.name}`;
    await openNewChat(page);
    await sendText(page, title);
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    await ensureSidebarOpen(page);
    const aside = sidebar(page);
    const row = aside.getByRole("listitem").filter({ has: page.getByRole("link", { name: title }) });
    await row.getByRole("button", { name: `Actions for ${title}` }).click();
    await page.getByRole("menuitem", { name: "Pin" }).click();
    const pinnedSection = aside.getByRole("region", { name: "Pinned" });
    await expect(pinnedSection.getByRole("link", { name: title })).toBeVisible();
    await page.reload();
    await ensureSidebarOpen(page);
    await expect(aside.getByRole("region", { name: "Pinned" }).getByRole("link", { name: title })).toBeVisible();
    await aside.getByRole("listitem").filter({ has: page.getByRole("link", { name: title }) }).getByRole("button", { name: `Actions for ${title}` }).click();
    await page.getByRole("menuitem", { name: "Unpin" }).click();
    await expect(aside.getByRole("region", { name: "Pinned" })).toHaveCount(0);
  });

  test("clicking the header title edits it in place: Enter saves, Escape cancels", async ({ page }, info) => {
    const title = `inline ${info.project.name}`;
    await openNewChat(page);
    await sendText(page, title);
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    const heading = page.getByTestId("chat-title").locator("visible=true").first();
    await page.getByRole("button", { name: `Rename chat: ${title}` }).click();
    const input = page.getByRole("textbox", { name: "Chat title" });
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(title);
    await input.fill(`${title} renamed`);
    await input.press("Enter");
    await expect(heading).toHaveText(`${title} renamed`);
    await ensureSidebarOpen(page);
    await expect(sidebar(page).getByRole("link", { name: `${title} renamed` })).toHaveCount(1);
    await page.reload();
    await expect(heading).toHaveText(`${title} renamed`, { timeout: 15_000 });
    await page.getByRole("button", { name: `Rename chat: ${title} renamed` }).click();
    await page.getByRole("textbox", { name: "Chat title" }).fill("not this");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("textbox", { name: "Chat title" })).toHaveCount(0);
    await expect(heading).toHaveText(`${title} renamed`);
  });

  test("rename, search, and delete a chat", async ({ page }) => {
    await openNewChat(page);
    const firstUrl = page.url();
    await sendText(page, "pineapple pizza debate");
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    await ensureSidebarOpen(page);
    const item = sidebar(page).getByRole("button", { name: /Actions for pineapple/ }).first();
    await item.click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await page.getByRole("textbox", { name: "Chat title" }).fill("Renamed chat");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("chat-title").locator("visible=true").first()).toHaveText("Renamed chat");

    await page.getByRole("button", { name: "Search chats" }).first().click();
    await page.getByRole("textbox", { name: "Search chats" }).fill("pineapple");
    await expect(page.getByRole("dialog").getByRole("link", { name: /Renamed chat/ }).first()).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Escape");

    await ensureSidebarOpen(page);
    await sidebar(page).getByRole("button", { name: /Actions for Renamed chat/ }).first().click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    // The dialog opens on Delete, so Enter confirms.
    await expect(page.getByRole("dialog").getByRole("button", { name: "Delete" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).not.toHaveURL(firstUrl);
    await expect(page).toHaveURL(CHAT_URL);
  });
});

test.describe("keyboard", () => {
  test.skip(({ isMobile }) => !!isMobile, "hardware keyboard shortcuts are a desktop expansion");
  test("Enter sends, ↑ edits the last message, ⌘K opens search, Esc closes it", async ({ page }) => {
    await openNewChat(page);
    const box = page.getByRole("textbox", { name: "Message" });
    await box.fill("keyboard send");
    await box.press("Enter");
    await expect(page.locator('[data-role="user"]:visible').last()).toContainText("keyboard send");
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    await box.press("ArrowUp");
    await expect(box).toHaveValue("keyboard send");
    await box.press("Escape");
    await expect(box).toHaveValue("");
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("textbox", { name: "Search chats" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("textbox", { name: "Search chats" })).toBeHidden();
    expect(await assistantText(lastAssistant(page))).not.toBe("");
  });
});
