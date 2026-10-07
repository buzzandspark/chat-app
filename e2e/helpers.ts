import { randomUUID } from "node:crypto";
import { expect, type Locator, type Page } from "@playwright/test";

export const CHAT_URL = /\/c\/[0-9a-f-]{36}$/;

/** A new chat is a fresh id with no rows (ADR-0005); the `/c/new` alias redirects to one. */
export function newChatPath(): string {
  return `/c/${randomUUID()}`;
}

export async function openNewChat(page: Page): Promise<void> {
  await page.goto(newChatPath());
  await waitForComposer(page);
}

/** The composer is server-rendered; wait for hydration before typing into it. */
export async function waitForComposer(page: Page): Promise<void> {
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
  await expect(visible(page, "composer")).toHaveAttribute("data-hydrated", "true");
}

// Next keeps the previous page mounted but hidden after a client-side navigation, so test-id
// locators must be scoped to visible elements (role queries already skip hidden ones).
export function visible(page: Page, testId: string): Locator {
  return page.getByTestId(testId).locator("visible=true").first();
}

export async function runScenario(page: Page, name: string): Promise<void> {
  await visible(page, "scenario-panel-trigger").click();
  await visible(page, `scenario-${name}`).click();
}

/** Visible only: Next keeps the previous page mounted hidden after a client-side navigation. */
export function lastAssistant(page: Page): Locator {
  return page.locator('[data-role="assistant"]:visible').last();
}

/** The URL is the chat's own from the start; kept for specs that reload after a send. */
export async function waitForChatUrl(page: Page): Promise<void> {
  await expect(page).toHaveURL(CHAT_URL, { timeout: 15_000 });
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
