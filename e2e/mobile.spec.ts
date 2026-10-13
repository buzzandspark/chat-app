import { expect, test } from "@playwright/test";
import { openNewChat, sidebar } from "./helpers";

test.describe("mobile", () => {
  test.skip(({ isMobile }) => !isMobile, "phone behaviours");

  test("the back gesture closes the phone sidebar and a sheet without leaving the chat", async ({ page }) => {
    await openNewChat(page);
    const url = page.url();
    const aside = sidebar(page);
    await page.getByRole("button", { name: "Open sidebar" }).click();
    await expect(aside).toHaveAttribute("data-open", "true");
    await page.goBack();
    await expect(aside).toHaveAttribute("data-open", "false");
    expect(page.url()).toBe(url);

    await page.getByRole("button", { name: "Open sidebar" }).click();
    await expect(aside).toHaveAttribute("data-open", "true");
    await page.getByRole("button", { name: "Search chats" }).first().click();
    await expect(page.getByRole("textbox", { name: "Search chats" })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("textbox", { name: "Search chats" })).toBeHidden();
    expect(page.url()).toBe(url);
    await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
  });

  test("the open sidebar is a modal dialog that takes focus and hands it back; closed it is inert", async ({ page }) => {
    await openNewChat(page);
    const aside = sidebar(page);
    const menu = page.getByRole("button", { name: "Open sidebar" });
    await expect(aside).toHaveAttribute("inert");
    await menu.click();
    await expect(aside).toHaveAttribute("role", "dialog");
    await expect(aside).toHaveAttribute("aria-modal", "true");
    await expect(aside).not.toHaveAttribute("inert");
    await expect(aside).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(aside).toHaveAttribute("inert");
    await expect(aside).not.toHaveAttribute("role");
    await expect(menu).toBeFocused();

    await menu.click();
    await page.getByRole("button", { name: "Close sidebar" }).click();
    await expect(aside).toHaveAttribute("inert");
    await expect(menu).toBeFocused();
  });

  test("inputs keep 16 px text at tablet widths", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 500 });
    await openNewChat(page);
    const size = await page.getByRole("textbox", { name: "Message" }).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(16);
    await page.getByRole("button", { name: "Search chats" }).first().click();
    const search = await page.getByRole("textbox", { name: "Search chats" }).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(search).toBeGreaterThanOrEqual(16);
    await page.goto("/login");
    for (const name of ["Email", "Password"]) {
      const px = await page.getByLabel(name).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(px, name).toBeGreaterThanOrEqual(16);
    }
  });
});
