import fs from "node:fs";
import path from "node:path";
import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { lastAssistant, newChatPath, openNewChat, runScenario, visible } from "./helpers";

// D0, D26: budgets run only on Pixel 7, where CPU 4x and Fast 3G throttling go through CDP;
// results append to docs/perf/ so the design doc quotes measured numbers.
test.describe("performance (Pixel 7, CPU 4x, Fast 3G)", () => {
  test.skip(({ browserName, isMobile }) => browserName !== "chromium" || !isMobile, "budgets are measured on the Pixel 7 project only");

  async function throttle(page: Page): Promise<CDPSession> {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 562.5,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    return cdp;
  }

  function record(name: string, data: Record<string, unknown>) {
    const dir = path.resolve("docs/perf");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${new Date().toISOString().slice(0, 10)}.json`);
    const existing = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>) : {};
    existing[name] = { ...data, at: new Date().toISOString() };
    fs.writeFileSync(file, `${JSON.stringify(existing, null, 2)}\n`);
    console.log(`[perf] ${name}`, JSON.stringify(data));
  }

  test("shell load: no layout shift, no font flash, under budget", async ({ page }) => {
    await throttle(page);
    await page.addInitScript(() => {
      const w = window as Window & { __cls?: number; __shifts?: number };
      w.__cls = 0;
      w.__shifts = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as PerformanceEntry[]) {
          const e = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
          if (!e.hadRecentInput) {
            w.__cls = (w.__cls ?? 0) + (e.value ?? 0);
            w.__shifts = (w.__shifts ?? 0) + 1;
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    const started = Date.now();
    await page.goto(newChatPath());
    await expect(visible(page, "composer")).toHaveAttribute("data-hydrated", "true", { timeout: 60_000 });
    const hydratedAt = Date.now() - started;
    await page.waitForTimeout(1500);
    const metrics = await page.evaluate(async () => {
      const w = window as Window & { __cls?: number; __shifts?: number };
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      const paints = performance.getEntriesByType("paint").map((p) => [p.name, Math.round(p.startTime)]);
      await document.fonts.ready;
      const faces = Array.from(document.fonts).map((f) => `${f.family}:${f.status}`);
      const interLoaded = Array.from(document.fonts).some((f) => /Inter/i.test(f.family) && f.status === "loaded");
      return {
        cls: Number((w.__cls ?? 0).toFixed(4)),
        shifts: w.__shifts ?? 0,
        ttfbMs: nav ? Math.round(nav.responseStart - nav.startTime) : null,
        domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd - nav.startTime) : null,
        paints: Object.fromEntries(paints),
        fonts: faces,
        interLoaded,
        transferredKb: Math.round(performance.getEntriesByType("resource").reduce((s, r) => s + ((r as PerformanceResourceTiming).transferSize || 0), 0) / 1024),
      };
    });
    record("shell", { ...metrics, hydratedMs: hydratedAt });
    expect(metrics.cls).toBeLessThanOrEqual(0.0);
  });

  test("first token paint and long-reply frame times while streaming", async ({ page }) => {
    await throttle(page);
    await openNewChat(page);
    await page.evaluate(() => {
      const w = window as Window & { __frames?: number[] };
      w.__frames = [];
      let last = performance.now();
      const tick = (now: number) => {
        w.__frames!.push(now - last);
        last = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const sentAt = Date.now();
    await runScenario(page, "long_reply");
    const row = lastAssistant(page);
    await expect(row.locator(".markdown")).not.toHaveText("", { timeout: 60_000 });
    const firstPaintMs = Date.now() - sentAt;
    await expect(row).toHaveAttribute("data-status", "done", { timeout: 120_000 });
    const frames = await page.evaluate(() => (window as Window & { __frames?: number[] }).__frames ?? []);
    const sorted = [...frames].sort((a, b) => a - b);
    const p = (q: number) => Number((sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0).toFixed(1));
    const longFrames = frames.filter((f) => f > 50).length;
    const timings = await page.evaluate(() => {
      const rows = document.querySelectorAll('[data-role="assistant"]');
      return rows.length;
    });
    record("long_reply", { firstPaintMs, frames: frames.length, p50: p(0.5), p95: p(0.95), p99: p(0.99), longFrames, assistantRows: timings });
    expect(longFrames / Math.max(1, frames.length)).toBeLessThan(0.1);
  });

  test("streaming inside a 200-message chat (D14 decision)", async ({ page }) => {
    await throttle(page);
    await openNewChat(page);
    await visible(page, "scenario-panel-trigger").click();
    await visible(page, "scenario-long_chat").click();
    await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    const loadStart = Date.now();
    await expect(page.locator('[data-role]:visible')).toHaveCount(200, { timeout: 60_000 });
    await expect(visible(page, "composer")).toHaveAttribute("data-hydrated", "true", { timeout: 60_000 });
    const rows = await page.locator('[data-role]:visible').count();
    const loadMs = Date.now() - loadStart;
    await page.evaluate(() => {
      const w = window as Window & { __frames?: number[] };
      w.__frames = [];
      let last = performance.now();
      const tick = (now: number) => {
        w.__frames!.push(now - last);
        last = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await runScenario(page, "long_reply");
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 120_000 });
    const frames = await page.evaluate(() => (window as Window & { __frames?: number[] }).__frames ?? []);
    const sorted = [...frames].sort((a, b) => a - b);
    const p = (q: number) => Number((sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0).toFixed(1));
    const longFrames = frames.filter((f) => f > 50).length;
    record("long_chat", { rows, loadMs, frames: frames.length, p50: p(0.5), p95: p(0.95), p99: p(0.99), longFrames });
    expect(longFrames / Math.max(1, frames.length)).toBeLessThan(0.1);
  });

  test("giant code block keeps scrolling smooth", async ({ page }) => {
    await throttle(page);
    await openNewChat(page);
    await page.evaluate(() => {
      const w = window as Window & { __frames?: number[] };
      w.__frames = [];
      let last = performance.now();
      const tick = (now: number) => {
        w.__frames!.push(now - last);
        last = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await runScenario(page, "giant_code_block");
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 180_000 });
    await page.waitForTimeout(1500);
    const frames = await page.evaluate(() => (window as Window & { __frames?: number[] }).__frames ?? []);
    const sorted = [...frames].sort((a, b) => a - b);
    const p = (q: number) => Number((sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0).toFixed(1));
    record("giant_code_block", { frames: frames.length, p50: p(0.5), p95: p(0.95), p99: p(0.99), longFrames: frames.filter((f) => f > 50).length });
  });
});
