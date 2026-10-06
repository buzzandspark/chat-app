import { expect, test } from "@playwright/test";
import { lastAssistant, openNewChat, runScenario } from "./helpers";

async function noHorizontalScroll(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("phone layout", () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test("320 px: landing, new chat, and a giant code block have no horizontal scroll", async ({ page }) => {
    await page.goto("/");
    await noHorizontalScroll(page);
    await openNewChat(page);
    await noHorizontalScroll(page);
    await runScenario(page, "giant_code_block");
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 60_000 });
    await noHorizontalScroll(page);
  });

  test("composer controls are at least 44 px tall", async ({ page }) => {
    await openNewChat(page);
    for (const name of ["Send message", "Choose model", "Show sidebar"]) {
      const box = await page.getByRole("button", { name }).boundingBox();
      expect(box, name).not.toBeNull();
      expect(box!.height, name).toBeGreaterThanOrEqual(44);
    }
  });

  test("the sidebar opens from the menu button and closes with Escape", async ({ page }) => {
    await openNewChat(page);
    await page.getByRole("button", { name: "Show sidebar" }).click();
    const aside = page.getByRole("complementary", { name: "Chats" });
    await expect(aside).toHaveAttribute("data-open", "true");
    await page.keyboard.press("Escape");
    await expect(aside).toHaveAttribute("data-open", "false");
  });
});
