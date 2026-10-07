// D0/D28: design-review screenshots into docs/design/<label>/: phone frame first, then desktop.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, devices, type Page } from "@playwright/test";

const label = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const port = 3125;
const base = `http://127.0.0.1:${port}`;
const out = path.resolve("docs/design", label);
fs.mkdirSync(out, { recursive: true });

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not start");
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log(`wrote ${name}.png`);
}

async function setTheme(page: Page, dark: boolean): Promise<void> {
  await page.evaluate((d) => {
    localStorage.setItem("cadence-theme", d ? "dark" : "light");
    document.documentElement.classList.toggle("dark", d);
  }, dark);
}

async function runScenario(page: Page, name: string): Promise<void> {
  await page.getByTestId("scenario-panel-trigger").click();
  await page.getByTestId(`scenario-${name}`).click();
}

async function capture(frame: "phone" | "desktop", dark: boolean): Promise<void> {
  const browser = await chromium.launch();
  const context = await browser.newContext(
    frame === "phone" ? { ...devices["Pixel 7"] } : { viewport: { width: 1440, height: 900 } },
  );
  const page = await context.newPage();
  const tag = `${frame}-${dark ? "dark" : "light"}`;
  await page.goto(`${base}/`);
  await setTheme(page, dark);
  await page.reload();
  await shot(page, `${tag}-01-landing`);
  await page.goto(`${base}/c/new`);
  await page.waitForSelector('[data-testid="composer"]');
  await shot(page, `${tag}-02-new-chat`);
  await page.getByTestId("scenario-panel-trigger").click();
  await page.waitForTimeout(400);
  await shot(page, `${tag}-03-scenario-sheet`);
  await page.getByTestId("scenario-fallback_mid_stream").click();
  await page.waitForSelector('[data-role="assistant"]');
  await page.waitForTimeout(1500);
  await shot(page, `${tag}-04-streaming-thinking`);
  await page.waitForSelector('[data-role="assistant"][data-status="done"]', { timeout: 60_000 });
  await shot(page, `${tag}-05-done-fallback`);
  await runScenario(page, "giant_code_block");
  // The newest reply must be done (an earlier done row would match too soon and the next send is refused while streaming).
  await page.waitForFunction(() => [...document.querySelectorAll('[data-role="assistant"]')].at(-1)?.getAttribute("data-status") === "done", null, { timeout: 90_000 });
  await page.waitForTimeout(1200);
  await shot(page, `${tag}-06-code-block`);
  await runScenario(page, "refusal_partial");
  await page.waitForSelector('[data-role="assistant"][data-status="refused"]', { timeout: 60_000 });
  await shot(page, `${tag}-07-refusal`);
  await page.getByRole("button", { name: "Choose model" }).click();
  await page.waitForTimeout(400);
  await shot(page, `${tag}-08-model-picker`);
  await page.keyboard.press("Escape");
  if (frame === "phone") {
    await page.getByRole("button", { name: "Show sidebar" }).click();
    await page.waitForTimeout(400);
    await shot(page, `${tag}-09-sidebar`);
  }
  await browser.close();
}

async function main(): Promise<void> {
  const dbPath = path.resolve("data/screenshots.db");
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) fs.rmSync(f, { force: true });
  const server = spawn("sh", ["scripts/standalone.sh"], {
    env: { ...process.env, PORT: String(port), HOSTNAME: "127.0.0.1", REPLAY_MODE: "1", E2E: "1", DATABASE_PATH: dbPath },
    stdio: "ignore",
  });
  try {
    await waitForServer();
    await capture("phone", false);
    await capture("phone", true);
    await capture("desktop", false);
    await capture("desktop", true);
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
