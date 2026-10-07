import { expect, test } from "@playwright/test";
import { openNewChat } from "./helpers";

test.describe("mobile", () => {
  test.skip(({ isMobile }) => !isMobile, "phone behaviours");

  test("the back gesture closes the phone sidebar and a sheet without leaving the chat", async ({ page }) => {
    await openNewChat(page);
    const url = page.url();
    const aside = page.getByRole("complementary", { name: "Chats" });
    await page.getByRole("button", { name: "Show sidebar" }).click();
    await expect(aside).toHaveAttribute("data-open", "true");
    await page.goBack();
    await expect(aside).toHaveAttribute("data-open", "false");
    expect(page.url()).toBe(url);

    await page.getByRole("button", { name: "Show sidebar" }).click();
    await expect(aside).toHaveAttribute("data-open", "true");
    await page.getByRole("button", { name: "Search chats" }).first().click();
    await expect(page.getByRole("textbox", { name: "Search chats" })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("textbox", { name: "Search chats" })).toBeHidden();
    expect(page.url()).toBe(url);
    await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
  });

  test("inputs keep 16 px text at tablet widths", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 500 });
    await openNewChat(page);
    const size = await page.getByRole("textbox", { name: "Message" }).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(16);
    await page.getByRole("button", { name: "Search chats" }).first().click();
    const search = await page.getByRole("textbox", { name: "Search chats" }).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(search).toBeGreaterThanOrEqual(16);
  });
});
