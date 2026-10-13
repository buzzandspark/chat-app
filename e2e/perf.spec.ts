import fs from "node:fs";
import path from "node:path";
import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { ensureSidebarOpen, lastAssistant, newChatPath, openNewChat, runScenario, sendText, sidebar, visible } from "./helpers";

// Budgets run only on Pixel 7, where CPU 4x and Fast 3G throttling go through CDP;
// results append to test-results/perf/<date>.json.
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
    const dir = path.resolve("test-results/perf");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${new Date().toISOString().slice(0, 10)}.json`);
    const existing = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>) : {};
    existing[name] = { ...data, at: new Date().toISOString() };
    fs.writeFileSync(file, `${JSON.stringify(existing, null, 2)}\n`);
    console.log(`[perf] ${name}`, JSON.stringify(data));
  }

  // Shared CI runners miss frame budgets set on a fast machine; PERF_BUDGETS=report records misses instead of failing.
  function budget(name: string, actual: number | null, op: "<" | "<=", limit: number) {
    if (process.env.PERF_BUDGETS !== "report") {
      if (op === "<") expect(actual, name).toBeLessThan(limit);
      else expect(actual, name).toBeLessThanOrEqual(limit);
      return;
    }
    if (actual !== null && (op === "<" ? actual < limit : actual <= limit)) return;
    const description = `${name}: ${actual} (budget ${op} ${limit})`;
    test.info().annotations.push({ type: "perf-budget-miss", description });
    console.warn(`[perf] budget miss ${description}`);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- perf budget miss: ${description}\n`);
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
    // Scripts fetched after hydration with no interaction (Radix chunks used to load at mount).
    const chunksAfterHydration = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      const hydrated = nav ? nav.domContentLoadedEventEnd : 0;
      return performance
        .getEntriesByType("resource")
        .filter((r) => r.name.includes("/_next/static/chunks/") && r.name.endsWith(".js") && r.startTime > hydrated + 500).length;
    });
    record("shell", { ...metrics, hydratedMs: hydratedAt, chunksAfterHydration });
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
    budget("long_reply long-frame ratio", longFrames / Math.max(1, frames.length), "<", 0.1);
  });

  test("streaming inside a 200-message chat", async ({ page }) => {
    await throttle(page);
    await openNewChat(page);
    await visible(page, "scenario-panel-trigger").click();
    await visible(page, "scenario-long_chat").click();
    await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    const loadStart = Date.now();
    // The page ships the newest 100 rows; the rest load when the reader nears the top.
    await expect(page.locator('[data-role]:visible')).toHaveCount(100, { timeout: 60_000 });
    await visible(page, "message-list").evaluate((el) => el.scrollTo(0, 0));
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
    budget("long_chat long-frame ratio", longFrames / Math.max(1, frames.length), "<", 0.1);
  });

  // Click to thread painted, in frames after the click: a chat the store holds, one prefetched on hover,
  // and one tapped before the sidebar's top-five prefetch lands.
  test("click to thread: loaded, prefetched and cold chats", async ({ page }, info) => {
    await throttle(page);
    // The database outlives retries and repeats, so each attempt gets its own titles.
    const run = `${info.retry}-${info.repeatEachIndex}`;
    const titles = [`alpha nav ${run}`, `bravo nav ${run}`, `charlie nav ${run}`] as const;
    const [alpha, bravo, charlie] = titles;
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
      await sidebar(page).getByRole("link", { name: title, exact: true }).click();
      await page.waitForFunction(() => (window as Window & { __nav?: { threadFrame: number | null } }).__nav?.threadFrame !== null, null, { timeout: 30_000 });
      return page.evaluate(() => (window as Window & { __nav?: { click: number | null; frames: number; activeFrame: number | null; skeletonFrame: number | null; threadFrame: number | null; threadMs: number | null } }).__nav!);
    };

    // Opening the sidebar starts the top-five prefetch; this first tap races it.
    const coldInFlight = await clickRow(alpha);
    const warmedByOpen = await clickRow(bravo);
    const loaded = await clickRow(alpha);
    await ensureSidebarOpen(page);
    await sidebar(page).getByRole("link", { name: charlie, exact: true }).hover();
    await page.waitForTimeout(1500);
    const prefetched = await clickRow(charlie);
    const loaded2 = await clickRow(bravo);
    record("click_to_thread", { coldInFlight, warmedByOpen, loaded, loaded2, prefetched });
    // Loaded or prefetched: the highlight in the first frame after the click, the thread by the second
    // (the router commits the navigation in a transition, one frame after the click's own task).
    for (const [label, c] of Object.entries({ loaded, loaded2, prefetched, warmedByOpen })) {
      budget(`${label} activeFrame`, c.activeFrame, "<=", 1);
      budget(`${label} threadFrame`, c.threadFrame, "<=", 2);
      expect(c.skeletonFrame, `${label} skeletonFrame`).toBeNull();
    }
    // Cold: the row highlights in the first frame and the skeleton is up by the third (measured 2 to 3
    // at 4x CPU); rows follow the fetch.
    budget("coldInFlight activeFrame", coldInFlight.activeFrame, "<=", 1);
    budget("coldInFlight skeletonFrame", coldInFlight.skeletonFrame, "<=", 3);
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
    await page.evaluate(() => {
      // Long frames annotated with what the block was doing: streaming, tokens arrived, groups committed.
      const w = window as Window & { __frames?: number[]; __long?: Array<{ at: number; dt: number; state: string }>; __state?: string };
      w.__long = [];
      w.__state = "streaming";
      const mo = new MutationObserver(() => {
        const block = [...document.querySelectorAll(".markdown-code")].at(-1);
        const row = [...document.querySelectorAll('[data-role="assistant"]')].at(-1);
        w.__state = `status=${row?.getAttribute("data-status")} highlighted=${block?.getAttribute("data-highlighted")} committed=${block?.getAttribute("data-committed")}`;
      });
      mo.observe(document.body, { attributes: true, subtree: true, attributeFilter: ["data-status", "data-highlighted", "data-committed"] });
      let last = performance.now();
      const tick = (now: number) => {
        if (now - last > 50) w.__long!.push({ at: Math.round(now), dt: Math.round(now - last), state: w.__state ?? "" });
        last = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await runScenario(page, "giant_code_block");
    await expect(lastAssistant(page)).toHaveAttribute("data-status", "done", { timeout: 180_000 });
    await expect(lastAssistant(page).locator(".markdown-code")).toHaveAttribute("data-committed", "all", { timeout: 30_000 });
    await page.waitForTimeout(1500);
    const longAnnotated = await page.evaluate(() => (window as Window & { __long?: unknown[] }).__long ?? []);
    console.log("[perf] giant_code_block long frames", JSON.stringify(longAnnotated));
    const source = await lastAssistant(page).locator(".markdown-code").getAttribute("data-highlight-source");
    const frames = await page.evaluate(() => (window as Window & { __frames?: number[] }).__frames ?? []);
    const sorted = [...frames].sort((a, b) => a - b);
    const p = (q: number) => Number((sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0).toFixed(1));
    const maxFrame = Number(Math.max(0, ...frames).toFixed(1));
    // Reopening must not tokenise or commit the block in one go: the hidden view keeps its chat
    // (Activity), so a reopen shows the same element and a remount is a cache hit.
    const chatUrl = page.url();
    await lastAssistant(page).locator(".markdown-code").evaluate((el) => {
      (el as HTMLElement & { __kept?: boolean }).__kept = true;
    });
    await ensureSidebarOpen(page);
    await page.getByRole("link", { name: "New chat" }).click();
    await expect(page).not.toHaveURL(chatUrl);
    await expect(visible(page, "composer")).toBeVisible({ timeout: 30_000 });
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
    await ensureSidebarOpen(page);
    // By href, not title: layout.spec runs the same scenario earlier in the suite, so the title is not unique.
    await sidebar(page).locator(`a[href="${new URL(chatUrl).pathname}"]`).click();
    await expect(page).toHaveURL(chatUrl);
    await expect(lastAssistant(page).locator(".markdown-code")).toHaveAttribute("data-committed", "all", { timeout: 30_000 });
    await page.waitForTimeout(1000);
    const reopenFrames = await page.evaluate(() => (window as Window & { __frames?: number[] }).__frames ?? []);
    const reopenMaxFrame = Number(Math.max(0, ...reopenFrames).toFixed(1));
    const reopen = await lastAssistant(page)
      .locator(".markdown-code")
      .evaluate((el) => ({ kept: (el as HTMLElement & { __kept?: boolean }).__kept === true, source: el.getAttribute("data-highlight-source") }));
    const reopenSource = reopen.kept ? "kept" : reopen.source;
    record("giant_code_block", {
      frames: frames.length,
      p50: p(0.5),
      p95: p(0.95),
      p99: p(0.99),
      longFrames: frames.filter((f) => f > 50).length,
      maxFrame,
      reopenMaxFrame,
      reopenLongFrames: reopenFrames.filter((f) => f > 50).length,
      source,
      reopenSource,
    });
    expect(source).toBe("worker");
    expect(["kept", "cache"]).toContain(reopenSource);
    // Measured at 4x CPU: longest frame ~317 ms at reply end, ~367 ms on reopen. Remaining spikes recur
    // every ~30 groups and grow with the DOM (GC or style work, not tokenising).
    budget("giant_code_block maxFrame", maxFrame, "<", 500);
    budget("giant_code_block reopenMaxFrame", reopenMaxFrame, "<", 500);
  });
});

// The sidebar is docked at md by CSS from the first paint, so a desktop cold load must not shift.
test.describe("desktop cold load", () => {
  test.skip(({ browserName, isMobile }) => browserName !== "chromium" || !!isMobile, "measured on the desktop project");

  test("no layout shift and the dock is in the first paint", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as Window & { __cls?: number; __shifts?: number; __shiftSources?: string[] };
      w.__cls = 0;
      w.__shifts = 0;
      w.__shiftSources = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as PerformanceEntry[]) {
          const e = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number; sources?: Array<{ node?: Element | null }> };
          if (!e.hadRecentInput) {
            w.__cls = (w.__cls ?? 0) + (e.value ?? 0);
            w.__shifts = (w.__shifts ?? 0) + 1;
            // What moved, for the log: a failure here is otherwise a number with no culprit.
            for (const s of e.sources ?? []) {
              const n = s.node;
              const prev = (s as { previousRect?: DOMRectReadOnly }).previousRect;
              const cur = (s as { currentRect?: DOMRectReadOnly }).currentRect;
              const move = prev && cur ? ` y ${Math.round(prev.y)}→${Math.round(cur.y)} h ${Math.round(prev.height)}→${Math.round(cur.height)}` : "";
              if (n) w.__shiftSources!.push(`${(e.value ?? 0).toFixed(4)} ${n.nodeName.toLowerCase()}${n.className ? "." + String(n.className).split(" ").slice(0, 3).join(".") : ""}${move} prev=${n.previousElementSibling?.nodeName.toLowerCase() ?? "-"}.${String(n.previousElementSibling?.className ?? "").split(" ").slice(0, 2).join(".")}`);
            }
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
      const w = window as Window & { __cls?: number; __shifts?: number; __shiftSources?: string[] };
      return { cls: Number((w.__cls ?? 0).toFixed(4)), shifts: w.__shifts ?? 0, sources: w.__shiftSources ?? [] };
    });
    const html = await (await page.request.get(page.url())).text();
    const dockedInHtml = /<aside[^>]*aria-label="Chats"[^>]*class="[^"]*dock:w-72/.test(html);
    fs.mkdirSync(path.resolve("test-results/perf"), { recursive: true });
    const file = path.join(path.resolve("test-results/perf"), `${new Date().toISOString().slice(0, 10)}.json`);
    const existing = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>) : {};
    existing.desktop_shell = { ...metrics, dockedInHtml, at: new Date().toISOString() };
    fs.writeFileSync(file, `${JSON.stringify(existing, null, 2)}\n`);
    console.log("[perf] desktop_shell", JSON.stringify({ ...metrics, dockedInHtml }));
    expect(dockedInHtml).toBe(true);
    expect(metrics.cls).toBeLessThanOrEqual(0.0);
  });
});
