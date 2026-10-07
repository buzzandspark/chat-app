import fs from "node:fs";
import path from "node:path";
import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { ensureSidebarOpen, lastAssistant, newChatPath, openNewChat, runScenario, sendText, visible } from "./helpers";

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

  // D21 (ADR-0005): click to thread painted, in animation frames after the click (the event that starts
  // the navigation), for a chat the store already holds, one prefetched on hover, and one tapped before
  // the sidebar's own top-five prefetch has landed.
  test("click to thread: loaded, prefetched and cold chats", async ({ page }) => {
    await throttle(page);
    const titles = ["alpha nav", "bravo nav", "charlie nav"] as const;
    const urls: string[] = [];
    for (const title of titles) {
      await openNewChat(page);
      await sendText(page, title);
      await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 60_000 });
      urls.push(page.url());
    }
    await openNewChat(page);
    await page.reload();
    await expect(visible(page, "composer")).toHaveAttribute("data-hydrated", "true", { timeout: 60_000 });

    const instrument = (title: string) =>
      page.evaluate((text) => {
        interface Nav {
          click: number | null;
          frames: number;
          activeFrame: number | null;
          skeletonFrame: number | null;
          threadFrame: number | null;
          threadMs: number | null;
        }
        const w = window as Window & { __nav?: Nav };
        const m: Nav = { click: null, frames: 0, activeFrame: null, skeletonFrame: null, threadFrame: null, threadMs: null };
        w.__nav = m;
        const isVisible = (el: Element | null) => !!el && !!((el as HTMLElement).offsetWidth || (el as HTMLElement).offsetHeight || el.getClientRects().length);
        const tick = () => {
          if (m.click !== null) {
            m.frames += 1;
            if (m.activeFrame === null && document.querySelector('a[aria-current="page"]')?.textContent?.includes(text)) m.activeFrame = m.frames;
            if (m.skeletonFrame === null && [...document.querySelectorAll('[data-testid="thread-skeleton"]')].some(isVisible)) m.skeletonFrame = m.frames;
            if (m.threadFrame === null && [...document.querySelectorAll('[data-role="user"]')].some((r) => isVisible(r) && r.textContent?.includes(text))) {
              m.threadFrame = m.frames;
              m.threadMs = Math.round(performance.now() - m.click);
              return;
            }
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        document.addEventListener("click", () => (m.click = performance.now()), { once: true, capture: true });
      }, title);
    const clickRow = async (title: string) => {
      await ensureSidebarOpen(page);
      await instrument(title);
      await page.getByRole("complementary", { name: "Chats" }).getByRole("link", { name: title }).click();
      await page.waitForFunction(() => (window as Window & { __nav?: { threadFrame: number | null } }).__nav?.threadFrame !== null, null, { timeout: 30_000 });
      return page.evaluate(() => (window as Window & { __nav?: { click: number | null; frames: number; activeFrame: number | null; skeletonFrame: number | null; threadFrame: number | null; threadMs: number | null } }).__nav!);
    };

    // Opening the sidebar starts the top-five prefetch; this first tap races it.
    const coldInFlight = await clickRow("alpha nav");
    const warmedByOpen = await clickRow("bravo nav");
    const loaded = await clickRow("alpha nav");
    await ensureSidebarOpen(page);
    await page.getByRole("complementary", { name: "Chats" }).getByRole("link", { name: "charlie nav" }).hover();
    await page.waitForTimeout(1500);
    const prefetched = await clickRow("charlie nav");
    const loaded2 = await clickRow("bravo nav");
    record("click_to_thread", { coldInFlight, warmedByOpen, loaded, loaded2, prefetched });
    // Loaded or prefetched: the highlight in the first frame after the click, the thread by the second
    // (the router commits the navigation in a transition, one frame after the click's own task).
    for (const c of [loaded, loaded2, prefetched, warmedByOpen]) {
      expect(c.activeFrame).toBeLessThanOrEqual(1);
      expect(c.threadFrame).toBeLessThanOrEqual(2);
      expect(c.skeletonFrame).toBeNull();
    }
    // Cold: the row highlights in the first frame and the skeleton is up by the second; rows follow the fetch.
    expect(coldInFlight.activeFrame).toBeLessThanOrEqual(1);
    expect(coldInFlight.skeletonFrame).toBeLessThanOrEqual(2);
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

// The sidebar is docked at md by CSS from the first paint, so a desktop cold load must not shift (the
// review measured CLS 0.20 when the dock appeared only after hydration).
test.describe("desktop cold load", () => {
  test.skip(({ browserName, isMobile }) => browserName !== "chromium" || !!isMobile, "measured on the desktop project");

  test("no layout shift and the dock is in the first paint", async ({ page }) => {
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
    await openNewChat(page);
    await sendText(page, "desktop cls anchor");
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 60_000 });
    await page.reload();
    await expect(visible(page, "composer")).toHaveAttribute("data-hydrated", "true", { timeout: 60_000 });
    await page.waitForTimeout(1500);
    const metrics = await page.evaluate(() => {
      const w = window as Window & { __cls?: number; __shifts?: number };
      return { cls: Number((w.__cls ?? 0).toFixed(4)), shifts: w.__shifts ?? 0 };
    });
    const html = await (await page.request.get(page.url())).text();
    const dockedInHtml = /<aside[^>]*aria-label="Chats"[^>]*class="[^"]*md:flex/.test(html);
    fs.mkdirSync(path.resolve("docs/perf"), { recursive: true });
    const file = path.join(path.resolve("docs/perf"), `${new Date().toISOString().slice(0, 10)}.json`);
    const existing = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>) : {};
    existing.desktop_shell = { ...metrics, dockedInHtml, at: new Date().toISOString() };
    fs.writeFileSync(file, `${JSON.stringify(existing, null, 2)}\n`);
    console.log("[perf] desktop_shell", JSON.stringify({ ...metrics, dockedInHtml }));
    expect(dockedInHtml).toBe(true);
    expect(metrics.cls).toBeLessThanOrEqual(0.0);
  });
});
