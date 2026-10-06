import { expect, type Locator, type Page } from "@playwright/test";

export async function openNewChat(page: Page): Promise<void> {
  await page.goto("/c/new");
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
}

export async function runScenario(page: Page, name: string): Promise<void> {
  await page.getByTestId("scenario-panel-trigger").click();
  await page.getByTestId(`scenario-${name}`).click();
}

export function lastAssistant(page: Page): Locator {
  return page.locator('[data-role="assistant"]').last();
}

export async function sendText(page: Page, text: string): Promise<void> {
  await page.getByRole("textbox", { name: "Message" }).fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
}

export function assistantText(row: Locator): Promise<string> {
  return row.locator(".markdown").allInnerTexts().then((parts) => parts.join("\n"));
}
