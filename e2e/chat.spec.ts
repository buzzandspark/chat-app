import { expect, test } from "@playwright/test";
import { assistantText, lastAssistant, openNewChat, runScenario, sendText, waitForChatUrl } from "./helpers";

test.describe("streaming", () => {
  test("send, stream, and finish a normal reply", async ({ page }) => {
    await openNewChat(page);
    await runScenario(page, "normal");
    const row = lastAssistant(page);
    await expect(row).toHaveAttribute("data-status", "streaming");
    await expect(row).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    expect(await assistantText(row)).toContain("Here is how resume works");
    await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
  });

  test("typing a message sends it and the reply streams", async ({ page }) => {
    await openNewChat(page);
    await sendText(page, "hello from the e2e test");
    await expect(page.locator('[data-role="user"]:visible').last()).toContainText("hello from the e2e test");
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  });

  test("stop is explicit and keeps the partial", async ({ page }) => {
    await openNewChat(page);
    await runScenario(page, "slow_tokens");
    const row = lastAssistant(page);
    await expect(row.locator(".markdown")).not.toHaveText("", { timeout: 20_000 });
    await page.getByRole("button", { name: "Stop generating" }).first().click();
    await expect(row).toHaveAttribute("data-status", "stopped", { timeout: 10_000 });
    await expect(row).toContainText("Stopped.");
    expect((await assistantText(row)).length).toBeGreaterThan(0);
  });
});

test.describe("reliability", () => {
  test("a dropped connection resumes with no duplicated or missing text", async ({ page }) => {
    await openNewChat(page);
    const resumed = page.waitForRequest((r) => r.url().includes("/events?after="), { timeout: 30_000 });
    await runScenario(page, "dropped_connection");
    const req = await resumed;
    expect(req.url()).toMatch(/after=\d+$/);
    const row = lastAssistant(page);
    await expect(row).toHaveAttribute("data-status", "done", { timeout: 60_000 });
    const text = await assistantText(row);
    expect(text.split("That is the whole protocol.").length - 1).toBe(1);
    expect(text.split("Section 12").length - 1).toBe(1);
    expect(text.split("Section 1\n").length - 1).toBe(1);
  });

  test("a stream that goes silent without closing is resumed by the watchdog and finishes intact", async ({ page }) => {
    test.setTimeout(120_000);
    await openNewChat(page);
    const resumed = page.waitForRequest((r) => r.url().includes("/events?after="), { timeout: 60_000 });
    await runScenario(page, "stalled_stream");
    const req = await resumed;
    expect(req.url()).toMatch(/after=\d+$/);
    const row = lastAssistant(page);
    await expect(row).toHaveAttribute("data-status", "done", { timeout: 90_000 });
    const text = await assistantText(row);
    expect(text.split("That is the whole protocol.").length - 1).toBe(1);
    expect(text.split("Section 12").length - 1).toBe(1);
  });

  // The slow_tokens scenario streams exactly this sentence; a resume that replayed from the saved
  // partial's start would show it twice (the review measured 6,414 characters against 5,444).
  const SLOW_TOKENS_TEXT =
    "The relay keeps every generation in an in-memory buffer keyed by id, with sequence numbers as array indices.";

  test("reloading mid-stream shows the reply still running and the final text is identical", async ({ page }) => {
    await openNewChat(page);
    await runScenario(page, "slow_tokens");
    const row = lastAssistant(page);
    await expect(row.locator(".markdown")).not.toHaveText("", { timeout: 20_000 });
    // Wait for at least one partial write (every 2 s) so the reload seeds a non-empty partial.
    await page.waitForTimeout(2500);
    await waitForChatUrl(page);
    await page.reload();
    const after = lastAssistant(page);
    await expect(after).toHaveAttribute("data-status", "streaming", { timeout: 10_000 });
    await expect(after).toHaveAttribute("data-status", "done", { timeout: 60_000 });
    expect((await assistantText(after)).trim()).toBe(SLOW_TOKENS_TEXT);
  });

  test("a second tab opened mid-stream ends with the same text as the first", async ({ page, context }) => {
    await openNewChat(page);
    await runScenario(page, "slow_tokens");
    const row = lastAssistant(page);
    await expect(row.locator(".markdown")).not.toHaveText("", { timeout: 20_000 });
    await page.waitForTimeout(2500);
    await waitForChatUrl(page);
    const second = await context.newPage();
    await second.goto(page.url());
    const twin = lastAssistant(second);
    await expect(twin).toHaveAttribute("data-status", "streaming", { timeout: 10_000 });
    await expect(row).toHaveAttribute("data-status", "done", { timeout: 60_000 });
    await expect(twin).toHaveAttribute("data-status", "done", { timeout: 60_000 });
    const first = (await assistantText(row)).trim();
    expect(first).toBe(SLOW_TOKENS_TEXT);
    expect((await assistantText(twin)).trim()).toBe(first);
    await second.close();
  });

  test("a producer restart shows interrupted with a retry", async ({ page }) => {
    await openNewChat(page);
    await runScenario(page, "producer_restart");
    const row = lastAssistant(page);
    await expect(row).toHaveAttribute("data-status", "interrupted", { timeout: 30_000 });
    await expect(row).toContainText("Interrupted: the server restarted");
    await expect(row.getByRole("button", { name: "Retry" })).toBeVisible();
    await row.getByRole("button", { name: "Retry" }).click();
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "streaming");
  });
});

test.describe("terminal states", () => {
  test("rate limited shows a countdown", async ({ page }) => {
    await openNewChat(page);
    await runScenario(page, "rate_limited");
    const row = lastAssistant(page);
    await expect(row).toHaveAttribute("data-status", "error", { timeout: 15_000 });
    await expect(row).toContainText("Rate limited");
  });

  test("a no-fallback refusal discards painted text", async ({ page }) => {
    await openNewChat(page);
    await runScenario(page, "refusal_partial");
    const row = lastAssistant(page);
    await expect(row).toHaveAttribute("data-status", "refused", { timeout: 30_000 });
    await expect(row).toContainText("Claude declined to continue this response.");
    await expect(row).toContainText("Incomplete and not saved.");
  });

  test("a mid-stream fallback shows a model divider", async ({ page }) => {
    await openNewChat(page);
    await runScenario(page, "fallback_mid_stream");
    const row = lastAssistant(page);
    await expect(row).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    await expect(row.getByRole("separator")).toContainText("Served by Claude Opus 4.8 after a safety fallback");
  });

  test("cut off at max_tokens offers Continue", async ({ page }) => {
    await openNewChat(page);
    await runScenario(page, "max_tokens");
    const row = lastAssistant(page);
    await expect(row).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    await expect(row).toContainText("Cut off at the output limit.");
    await expect(row.getByRole("button", { name: "Continue" })).toBeVisible();
  });

  test("context full tells the user to start a new chat", async ({ page }) => {
    await openNewChat(page);
    await runScenario(page, "context_full");
    const row = lastAssistant(page);
    await expect(row).toHaveAttribute("data-status", "error", { timeout: 15_000 });
    await expect(row).toContainText("This chat is too long to continue.");
  });
});
