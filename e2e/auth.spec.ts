import { expect, test, type Browser, type Page } from "@playwright/test";
import { lastAssistant, sendText, waitForComposer } from "./helpers";

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
  await expect(page).toHaveURL(/\/c\/new$/);
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
    await expect(page).toHaveURL(/\/c\/new$/);
    const { email, inviteUrl } = await createInvitee(page);

    const invitee = await freshPage(browser);
    await invitee.goto(inviteUrl);
    await invitee.getByLabel("New password").fill("a-strong-password-1");
    await invitee.getByRole("button", { name: "Set password and sign in" }).click();
    await expect(invitee).toHaveURL(/\/c\/new$/);
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
    await expect(invitee).toHaveURL(/\/c\/new$/);

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
    await expect(page).toHaveURL(/\/c\/new$/);
    await waitForComposer(page);
    await expect(page.getByTestId("scenario-panel-trigger").locator("visible=true").first()).toBeVisible();
    await sendText(page, "hello demo");
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 60_000 });
    await expect(page.getByText(/demo\.cadence\.invalid|Demo visitor/).first()).toBeVisible();
  });
});
