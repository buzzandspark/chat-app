import { expect, test, type Browser, type Page } from "@playwright/test";
import { CHAT_URL, lastAssistant, sendText, waitForComposer } from "./helpers";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "admin-password-123";

async function submitLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Signs in and waits for the session to take effect before navigating elsewhere. */
async function login(page: Page, email: string, password: string): Promise<void> {
  await submitLogin(page, email, password);
  await expect(page).toHaveURL(CHAT_URL);
}

async function createInvitee(page: Page): Promise<{ email: string; inviteUrl: string }> {
  const email = `invitee-${Date.now()}@example.com`;
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Create and invite" }).click();
  const inviteUrl = (await page.getByTestId("invite-url").textContent())?.trim() ?? "";
  expect(inviteUrl).toMatch(/\/invite\/[A-Za-z0-9_-]{20,}$/);
  return { email, inviteUrl };
}

async function freshPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

test.describe("accounts", () => {
  test("admin signs in, creates a user; the invite signs in once and is rejected the second time", async ({ page, browser }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect(page).toHaveURL(CHAT_URL);
    const { email, inviteUrl } = await createInvitee(page);

    const invitee = await freshPage(browser);
    await invitee.goto(inviteUrl);
    await invitee.getByLabel("New password").fill("a-strong-password-1");
    await invitee.getByRole("button", { name: "Set password and sign in" }).click();
    await expect(invitee).toHaveURL(CHAT_URL);
    await expect(invitee.getByText(email)).toBeVisible();

    const second = await freshPage(browser);
    await second.goto(inviteUrl);
    await expect(second.locator('p[role="alert"]')).toContainText("already been used");
  });

  test("admin disables a user and their sign-in stops working", async ({ page, browser }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const { email, inviteUrl } = await createInvitee(page);
    const invitee = await freshPage(browser);
    await invitee.goto(inviteUrl);
    await invitee.getByLabel("New password").fill("a-strong-password-2");
    await invitee.getByRole("button", { name: "Set password and sign in" }).click();
    await expect(invitee).toHaveURL(CHAT_URL);

    const card = page.getByTestId(`user-${email}`);
    await card.getByRole("button", { name: "Disable" }).click();
    await expect(card).toContainText("disabled");

    const again = await freshPage(browser);
    await submitLogin(again, email, "a-strong-password-2");
    await expect(again.locator('p[role="alert"]')).toBeVisible();
    await expect(again).toHaveURL(/\/login/);
  });

  test("the admin console is a 404 for anyone else", async ({ page }) => {
    // Partial prerendering streams the not-found boundary after a 200 shell, so check what the user sees.
    await page.goto("/admin");
    await expect(page.getByText(/404|could not be found/i).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Admin" })).toHaveCount(0);
  });
});

test.describe("demo", () => {
  test("Try the demo opens a private chat that streams from replay", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("try-demo").click();
    await expect(page).toHaveURL(CHAT_URL);
    await waitForComposer(page);
    await expect(page.getByTestId("scenario-panel-trigger").locator("visible=true").first()).toBeVisible();
    await sendText(page, "hello demo");
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 60_000 });
    await expect(page.getByText(/demo\.cadence\.invalid|Demo visitor/).first()).toBeVisible();
  });
});

test.describe("isolation and limits", () => {
  test("a signed-in user cannot read another user's stream, live or saved", async ({ page, browser }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.getByTestId("scenario-panel-trigger").locator("visible=true").first().click();
    await page.getByTestId("scenario-slow_tokens").click();
    const row = page.locator('[data-role="assistant"]:visible').last();
    await expect(row).toHaveAttribute("data-generation-id", /[0-9a-f-]{36}/);
    const generationId = (await row.getAttribute("data-generation-id"))!;
    const other = await freshPage(browser);
    await other.goto("/");
    await other.getByTestId("try-demo").click();
    await expect(other).toHaveURL(CHAT_URL);
    const live = await other.request.get(`/api/generations/${generationId}/events?after=-1`);
    expect(live.status()).toBe(403);
    await expect(row).toHaveAttribute("data-status", /done|stopped/, { timeout: 60_000 });
    const saved = await other.request.get(`/api/generations/${generationId}/events?after=-1`);
    expect(saved.status()).toBe(403);
    const stop = await other.request.post(`/api/generations/${generationId}/stop`);
    expect(stop.status()).toBe(403);
  });

  test("the demo endpoint is rate limited per address", async ({ request }) => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await request.post("/api/demo/start")).status());
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    expect(statuses[0]).toBe(200);
  });
});
