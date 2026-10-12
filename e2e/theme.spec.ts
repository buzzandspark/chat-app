import { expect, test } from "@playwright/test";
import { ensureSidebarOpen, openNewChat } from "./helpers";

// The theme script is a raw inline <script> in <head> ahead of every Next script, so a stored dark
// preference is applied before the first paint, and the element is not re-created on the client.
test.describe("theme", () => {
  test("a stored dark theme is applied before the first paint", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("chat-theme", "dark");
      const w = window as Window & { __darkAt?: number };
      const check = () => {
        if (document.documentElement?.classList.contains("dark") && w.__darkAt === undefined) w.__darkAt = performance.now();
      };
      // An init script runs before <html> exists, so observe the document and let subtree cover the root.
      new MutationObserver(check).observe(document, { attributes: true, subtree: true, attributeFilter: ["class"] });
      check();
    });
    await openNewChat(page);
    const timing = await page.evaluate(() => {
      const w = window as Window & { __darkAt?: number };
      const paint = performance.getEntriesByType("paint").find((p) => p.name === "first-paint");
      return { darkAt: w.__darkAt ?? null, firstPaint: paint ? paint.startTime : null, dark: document.documentElement.classList.contains("dark") };
    });
    expect(timing.dark).toBe(true);
    expect(timing.darkAt).not.toBeNull();
    if (timing.firstPaint !== null) expect(timing.darkAt!).toBeLessThanOrEqual(timing.firstPaint);

    // In the document, every script ahead of ours is an `async` chunk React hoisted to the top of
    // <head> (it cannot run before it is fetched, and Next paints nothing until the payload below
    // arrives); ours is the first script that executes synchronously, before the RSC payload and
    // before any non-async Next script.
    const html = await (await page.request.get(page.url())).text();
    const theme = html.indexOf('id="chat-theme"');
    expect(theme).toBeGreaterThan(-1);
    const before = html.slice(0, theme).match(/<script\b[^>]*>/g) ?? [];
    expect(before.length).toBeGreaterThan(0);
    for (const tag of before) expect(tag).toMatch(/\basync\b/);
    expect(html.indexOf("__next_f")).toBeGreaterThan(theme);
    const firstSyncNext = html.slice(theme).search(/<script\b(?![^>]*\basync\b)(?![^>]*\bnoModule\b)[^>]*src="\/_next\//);
    expect(firstSyncNext === -1 || firstSyncNext > 0).toBe(true);
    // Hydrated, the element is gone: the client never renders a script tag.
    await expect(page.locator("script#chat-theme")).toHaveCount(0);
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
    expect(errors.filter((e) => /script tag/i.test(e))).toHaveLength(0);
  });

  test("toggling the theme switches every control's colour in the same frame", async ({ page }) => {
    await openNewChat(page);
    await ensureSidebarOpen(page);
    await page.getByRole("textbox", { name: "Message" }).fill("hello");
    const toggle = page.getByRole("button", { name: /Switch to (dark|light) theme/ }).first();
    // Send's colour right after the click and once any transition would have run must match.
    const colours = await toggle.evaluate(async (button: HTMLElement) => {
      const send = document.querySelector<HTMLElement>('button[aria-label="Send message"]')!;
      button.click();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const first = getComputedStyle(send).backgroundColor;
      await new Promise((r) => setTimeout(r, 500));
      return [first, getComputedStyle(send).backgroundColor];
    });
    expect(colours[0]).toBe(colours[1]);
  });
});
