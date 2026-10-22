import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const runCount = fs.readdirSync(path.resolve("evals/runs")).filter((f) => f.endsWith(".json")).length;

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("evals", () => {
  test("the overview lists every run and opens the latest production run against its baseline", async ({ page }) => {
    await page.goto("/evals");
    await expect(page.getByRole("heading", { name: "Evals", level: 1 })).toBeVisible();
    await expect(page.getByRole("table", { name: "Every run, newest first" }).locator("tbody tr")).toHaveCount(runCount);
    await noHorizontalScroll(page);

    const latest = page.getByRole("region", { name: "What ships" }).getByRole("link");
    const id = (await latest.textContent()) ?? "";
    await latest.click();
    await expect(page).toHaveURL(`/evals/${id}`);
    await expect(page.getByRole("heading", { name: "production", level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: "Metrics" })).toContainText("Compared with");
    await noHorizontalScroll(page);

    // A case opens to its reply and each sample's answer.
    const first = page.getByRole("region", { name: "Cases" }).locator("details").first();
    await first.locator("summary").click();
    await expect(first.locator(".font-mono")).not.toBeEmpty();
    await expect(first.getByText("Sample 1", { exact: true }).first()).toBeVisible();
    await noHorizontalScroll(page);

    await page.getByRole("link", { name: "← All runs" }).click();
    await expect(page).toHaveURL(/\/evals$/);
  });

  test("a run id with no run is a 404", async ({ page }) => {
    const response = await page.goto("/evals/2026-01-01-production-000000");
    expect(response?.status()).toBe(404);
    await expect(page.getByText(/404|could not be found/i).first()).toBeVisible();
    await expect(page.getByRole("region", { name: "Metrics" })).toHaveCount(0);
  });
});
