import { expect, test, type Page } from "@playwright/test";
import { ensureSidebarOpen, lastAssistant, openNewChat, runScenario, sidebar, visible, waitForComposer } from "./helpers";

// The projects share the dev user: Explore is switched back on whatever a test did.
test.afterEach(async ({ request }) => {
  await request.patch("/api/settings", { data: { exploreOptions: true } });
});

async function openSettings(page: Page) {
  await ensureSidebarOpen(page);
  await sidebar(page).getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
}

async function setExplore(page: Page, on: boolean) {
  const toggle = page.getByRole("switch", { name: "Explore options" });
  await expect(toggle).toBeChecked({ checked: !on });
  const saved = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/settings" && r.request().method() === "PATCH");
  await toggle.click();
  expect((await saved).ok()).toBe(true);
  await expect(toggle).toBeChecked({ checked: on });
}

/** A client-side navigation, so the page keeps what the switch set rather than reloading it. */
async function newChatFromSidebar(page: Page) {
  await ensureSidebarOpen(page);
  await sidebar(page).getByRole("link", { name: "New chat" }).click();
  await waitForComposer(page);
}

async function replyWithOptions(page: Page) {
  await runScenario(page, "options_reply");
  await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
}

test.describe("settings", () => {
  test("the sidebar opens it, and it shows usage for chats and Explore", async ({ page, isMobile }) => {
    await openNewChat(page);
    await openSettings(page);
    // The phone overlay closes on the way, as it does for a chat.
    if (isMobile) await expect(sidebar(page)).toHaveAttribute("data-open", "false");
    await expect(page.getByRole("heading", { name: "Usage" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "This month" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "All time" })).toBeVisible();
    await expect(visible(page, "usage-chats")).toContainText("Chats");
    await expect(visible(page, "usage-chats")).toContainText(/\$\d+\.\d\d/);
    await expect(visible(page, "usage-explore")).toContainText("Explore");
    await expect(visible(page, "usage-explore")).toContainText(/in · .* out/);
  });

  test("with Explore options off, a reply with options brings no Explore button and no Haiku call; back on, it does", async ({ page }) => {
    const optionsRequests: string[] = [];
    page.on("request", (r) => {
      if (/^\/api\/messages\/[^/]+\/options$/.test(new URL(r.url()).pathname)) optionsRequests.push(r.url());
    });
    await openNewChat(page);
    await openSettings(page);
    await setExplore(page, false);
    await newChatFromSidebar(page);
    await replyWithOptions(page);
    // The scripted detection has its count 0.4 s after the reply and its list 1.5 s later; wait past both.
    await page.waitForTimeout(2500);
    await expect(page.getByTestId("explore-options").locator("visible=true")).toHaveCount(0);
    expect(optionsRequests).toEqual([]);
    // The server skipped the detection too: it has no options for the reply.
    const messageId = await lastAssistant(page).getAttribute("data-message-id");
    const lines = (await (await page.request.get(`/api/messages/${messageId}/options`)).text()).trim().split("\n");
    expect(JSON.parse(lines.at(-1) ?? "{}")).toMatchObject({ count: 0, options: [], done: true });

    await openSettings(page);
    await setExplore(page, true);
    await newChatFromSidebar(page);
    await replyWithOptions(page);
    await expect(visible(page, "explore-options")).toHaveText(/Explore 3 options/, { timeout: 15_000 });
  });
});
