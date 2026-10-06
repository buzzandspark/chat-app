import { expect, type Locator, type Page } from "@playwright/test";

export async function openNewChat(page: Page): Promise<void> {
  await page.goto("/c/new");
  await waitForComposer(page);
}

/** The composer is server-rendered; wait for hydration before typing into it. */
export async function waitForComposer(page: Page): Promise<void> {
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
  await expect(page.getByTestId("composer")).toHaveAttribute("data-hydrated", "true");
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

/** Opens the sidebar if it is closed, on any project, without toggling it shut. */
export async function ensureSidebarOpen(page: Page): Promise<void> {
  const aside = page.getByRole("complementary", { name: "Chats" });
  if ((await aside.getAttribute("data-open")) === "true") return;
  await page.getByRole("button", { name: "Show sidebar" }).click();
  await expect(aside).toHaveAttribute("data-open", "true");
}
