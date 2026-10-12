import { expect, test } from "@playwright/test";
import { lastAssistant, openNewChat, runScenario, sendText, visible } from "./helpers";

// D16 auto-follow and the thread's pinning (review findings on scroll).
test.describe("scroll", () => {
  test("auto-follow survives a long thinking block collapsing", async ({ page }) => {
    await openNewChat(page);
    await runScenario(page, "thinking_long");
    const row = lastAssistant(page);
    await expect(row).toHaveAttribute("data-status", "done", { timeout: 60_000 });
    await page.waitForTimeout(300);
    await expect(page.getByRole("button", { name: "Jump to latest" })).toHaveCount(0);
    const distance = await visible(page, "message-list").evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
    expect(distance).toBeLessThanOrEqual(2);
  });

  test("an upward wheel disengages auto-follow at once and Jump to latest re-engages it", async ({ page, isMobile }) => {
    test.skip(isMobile, "a wheel is a desktop input");
    await openNewChat(page);
    await runScenario(page, "long_reply");
    const row = lastAssistant(page);
    await expect(row.locator(".markdown")).not.toHaveText("", { timeout: 60_000 });
    const list = visible(page, "message-list");
    // Once there is something above to read back to.
    await expect.poll(() => list.evaluate((el) => el.scrollHeight - el.clientHeight), { timeout: 60_000 }).toBeGreaterThan(2);
    await list.hover();
    await page.mouse.wheel(0, -10);
    await expect(page.getByRole("button", { name: "Jump to latest" })).toBeVisible();
    await page.getByRole("button", { name: "Jump to latest" }).click();
    await expect(page.getByRole("button", { name: "Jump to latest" })).toHaveCount(0);
    await expect(row).toHaveAttribute("data-status", "done", { timeout: 60_000 });
    await page.waitForTimeout(200);
    const distance = await list.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
    expect(distance).toBeLessThanOrEqual(2);
  });

  test("a chat that fits on screen never offers Jump to latest", async ({ page, isMobile }) => {
    test.skip(isMobile, "a wheel is a desktop input");
    await openNewChat(page);
    await sendText(page, "a short question");
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    const list = visible(page, "message-list");
    expect(await list.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(2);
    await list.hover();
    await page.mouse.wheel(0, -200);
    await page.keyboard.press("PageUp");
    await page.waitForTimeout(300);
    await expect(page.getByRole("button", { name: "Jump to latest" })).toHaveCount(0);
  });

  test("the thread stays pinned to its end when the viewport shrinks (keyboard)", async ({ page, isMobile }) => {
    test.skip(!isMobile, "the keyboard inset only matters on phones");
    await openNewChat(page);
    await runScenario(page, "long_reply");
    const row = lastAssistant(page);
    await expect(row.locator(".markdown")).not.toHaveText("", { timeout: 60_000 });
    const size = page.viewportSize()!;
    await page.setViewportSize({ width: size.width, height: size.height - 300 });
    await page.waitForTimeout(250);
    const pinned = await visible(page, "message-list").evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
    expect(pinned).toBeLessThanOrEqual(2);
    await expect(row).toHaveAttribute("data-status", "done", { timeout: 60_000 });
    await page.waitForTimeout(100);
    const stillPinned = await visible(page, "message-list").evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
    expect(stillPinned).toBeLessThanOrEqual(2);
  });

  test("a long chat opens at its end and scrolls up in even steps", async ({ page }) => {
    // Registered before the first document: the long chat opens by client-side navigation.
    await page.addInitScript(() => {
      const w = window as Window & { __firstTops?: number[] };
      w.__firstTops = [];
      const tick = () => {
        const list = [...document.querySelectorAll('[data-testid="message-list"]')].find((el) => (el as HTMLElement).offsetHeight > 0);
        if (list && list.querySelector("[data-role]") && w.__firstTops!.length < 5) w.__firstTops!.push(list.scrollTop);
        if (w.__firstTops!.length < 5) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await openNewChat(page);
    const before = page.url();
    await visible(page, "scenario-panel-trigger").click();
    await visible(page, "scenario-long_chat").click();
    await expect(page).not.toHaveURL(before, { timeout: 30_000 });
    // The page ships the newest 100 of the 200 rows (#47); the rest load when the reader nears the top.
    await expect(page.locator("[data-role]:visible")).toHaveCount(100, { timeout: 60_000 });
    await page.waitForTimeout(500);
    const firstTops = await page.evaluate(() => (window as Window & { __firstTops?: number[] }).__firstTops ?? []);
    // Never painted at the top first: every observed frame with rows was already scrolled down.
    expect(firstTops.length).toBeGreaterThan(0);
    expect(Math.min(...firstTops)).toBeGreaterThan(0);

    // Each step should move what is on screen by exactly the scrolled distance. scrollTop itself may
    // legitimately differ where scroll anchoring compensates for rows above being sized, so the
    // measure is the on-screen movement of the row at the top of the viewport.
    const list = visible(page, "message-list");
    const moves: number[] = [];
    for (let i = 0; i < 20; i++) {
      const moved = await list.evaluate(async (el) => {
        const top = el.getBoundingClientRect().top;
        const rows = [...el.querySelectorAll("[data-role]")];
        const ref = rows.find((r) => r.getBoundingClientRect().bottom > top + 1) ?? rows[0]!;
        const was = ref.getBoundingClientRect().top;
        el.scrollBy(0, -300);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return ref.getBoundingClientRect().top - was;
      });
      moves.push(Math.round(moved));
      if ((await list.evaluate((el) => el.scrollTop)) === 0) break;
    }
    const uneven = moves.slice(0, -1).filter((m) => Math.abs(m - 300) > 4).length;
    expect(moves.length).toBeGreaterThan(5);
    expect(uneven).toBeLessThanOrEqual(1);
    // Reaching the top loads the earlier rows above, and the reader stays where they were rather than at the oldest.
    await list.evaluate((el) => el.scrollTo(0, 0));
    await expect(page.locator("[data-role]:visible")).toHaveCount(200, { timeout: 15_000 });
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(1000);
  });
});
