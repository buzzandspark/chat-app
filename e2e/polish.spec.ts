import { expect, test } from "@playwright/test";
import { assistantText, ensureSidebarOpen, lastAssistant, openNewChat, runScenario, sendText } from "./helpers";

test.describe("edit, regenerate, drafts", () => {
  test("editing the last message replaces it and regenerates", async ({ page }) => {
    await openNewChat(page);
    await sendText(page, "first version");
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    await page.locator('[data-role="user"]').last().getByRole("button", { name: "Message actions" }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    await expect(page.getByRole("menu")).toBeHidden();
    const box = page.getByRole("textbox", { name: "Message" });
    await expect(box).toHaveValue("first version");
    await box.fill("second version");
    await page.getByRole("button", { name: "Send edited message" }).click();
    await expect(page.locator('[data-role="user"]')).toHaveCount(1);
    await expect(page.locator('[data-role="user"]').last()).toContainText("second version");
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    await page.reload();
    await expect(page.locator('[data-role="user"]')).toHaveCount(1);
    await expect(page.locator('[data-role="user"]').last()).toContainText("second version");
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
    await page.reload();
    await expect(page.locator('[data-role="assistant"]')).toHaveCount(1);
  });

  test("a draft survives a reload", async ({ page }) => {
    await openNewChat(page);
    await sendText(page, "anchor");
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    await page.getByRole("textbox", { name: "Message" }).fill("unsent draft text");
    await page.waitForTimeout(400);
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue("unsent draft text");
  });

  test("the latency popover shows all six stages", async ({ page }) => {
    await openNewChat(page);
    await runScenario(page, "fallback_pre_output");
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    await lastAssistant(page).getByRole("button", { name: "Latency breakdown" }).click();
    const dialog = page.getByRole("dialog");
    for (const label of [
      "Client: sent → first byte",
      "Client: first byte → first paint",
      "Client: sent → done",
      "Server: received → upstream first token",
      "Server: upstream first token → first relayed",
      "Server: received → done",
    ]) {
      await expect(dialog).toContainText(label);
    }
    await expect(dialog).toContainText("includes a declined attempt");
    await expect(dialog).not.toContainText("Client: sent → done\n–");
  });
});

test.describe("chat management", () => {
  test("rename, search, and delete a chat", async ({ page }) => {
    await openNewChat(page);
    await sendText(page, "pineapple pizza debate");
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    await ensureSidebarOpen(page);
    const item = page.getByRole("complementary", { name: "Chats" }).getByRole("button", { name: /Actions for pineapple/ }).first();
    await item.click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await page.getByRole("textbox", { name: "Chat title" }).fill("Renamed chat");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("chat-title")).toHaveText("Renamed chat");

    await page.getByRole("button", { name: "Search chats" }).first().click();
    await page.getByRole("textbox", { name: "Search chats" }).fill("pineapple");
    await expect(page.getByRole("dialog").getByRole("link", { name: /Renamed chat/ }).first()).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Escape");

    await ensureSidebarOpen(page);
    await page.getByRole("complementary", { name: "Chats" }).getByRole("button", { name: /Actions for Renamed chat/ }).first().click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page).toHaveURL(/\/c\/new$/);
  });
});

test.describe("keyboard", () => {
  test.skip(({ isMobile }) => !!isMobile, "hardware keyboard shortcuts are a desktop expansion");
  test("Enter sends, ↑ edits the last message, ⌘K opens search, Esc closes it", async ({ page }) => {
    await openNewChat(page);
    const box = page.getByRole("textbox", { name: "Message" });
    await box.fill("keyboard send");
    await box.press("Enter");
    await expect(page.locator('[data-role="user"]').last()).toContainText("keyboard send");
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
