import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${port}`;

// Phone first (D0, D26): Pixel 7 is the default project and the only one with performance budgets,
// since throttling goes through CDP; iPhone 14 (WebKit) covers layout, desktop is the expansion.
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "pixel7", use: { ...devices["Pixel 7"] } },
    { name: "iphone14", use: { ...devices["iPhone 14"] } },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: "pnpm start:standalone",
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      REPLAY_MODE: "1",
      SCENARIO_PANEL: "1",
      DATABASE_PATH: path.resolve(process.cwd(), "data/e2e.db"),
      BETTER_AUTH_SECRET: "e2e-secret-not-for-production-0123456789",
      BETTER_AUTH_URL: baseURL,
      ADMIN_EMAIL: "admin@example.com",
      ADMIN_PASSWORD: "admin-password-123",
      ADMIN_PATH_SLUG: "admin",
      E2E: "1",
    },
  },
});
