import { expect, test } from "@playwright/test";
import { devLogin } from "./helpers";

/** README screenshots: SCREENSHOTS=1 pnpm test:e2e tests/e2e/screenshots.spec.ts */
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to regenerate docs/screenshots");

test("capture README screenshots", async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await devLogin(page);
  await page.screenshot({ path: "docs/screenshots/dashboard.png" });

  await page.locator("ul a[href^='/app/evaluations/']").first().click();
  await page.waitForURL(/\/app\/evaluations\/[^/]+$/);
  const evaluation = page.url();
  await page.getByRole("link", { name: "Submissions", exact: true }).click();
  const report = (await page.locator("a[href^='/app/reports/']").last().getAttribute("href"))!;

  await page.goto(`${evaluation}/setup/rubric`);
  await expect(page.getByRole("heading", { name: "Review your rubric" })).toBeVisible();
  await page.screenshot({ path: "docs/screenshots/rubric-editor.png" });

  await page.goto(report);
  await expect(page.getByRole("heading", { name: "Scorecard" })).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "docs/screenshots/report.png", fullPage: false });
  await page.getByRole("heading", { name: "Scorecard" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "docs/screenshots/report-scorecard.png" });

  await page.goto(`${evaluation}/leaderboard`);
  await expect(page.getByRole("table")).toBeVisible();
  await page.screenshot({ path: "docs/screenshots/leaderboard.png" });
});
