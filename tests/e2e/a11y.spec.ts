import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { devLogin, expectNoHorizontalScroll } from "./helpers";

/** Accessibility (axe, WCAG 2 A/AA) and 360 px responsiveness on the key screens. */
async function audit(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    serious.map(
      (v) =>
        `${label}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target.join(" ")} — ${v.nodes[0]?.any[0]?.message ?? ""}`,
    ),
  ).toEqual([]);
}

async function findReport(page: Page) {
  await page.goto("/app");
  const card = page.locator("ul a[href^='/app/evaluations/']").first();
  await card.click();
  await page.getByRole("link", { name: "Submissions", exact: true }).click();
  const link = page.locator("a[href^='/app/reports/']").first();
  await expect(link).toBeVisible();
  return (await link.getAttribute("href"))!;
}

for (const theme of ["light", "dark"] as const) {
  test(`key screens have no serious axe violations (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/");
    await audit(page, "landing");
    await devLogin(page);
    await audit(page, "dashboard");
    await page.goto("/app/evaluations/new");
    await audit(page, "wizard");
    const report = await findReport(page);
    const evaluation = page.url().replace(/\/submissions$/, "");
    await audit(page, "submissions");
    await page.goto(`${evaluation}/setup/rubric`);
    await expect(page.getByRole("heading", { name: "Review your rubric" })).toBeVisible();
    await audit(page, "rubric editor");
    await page.goto(report);
    await expect(page.getByRole("heading", { name: "Scorecard" })).toBeVisible();
    await audit(page, "report");
    await page.goto(`${evaluation}/leaderboard`);
    await expect(page.getByRole("table")).toBeVisible();
    await audit(page, "leaderboard");
  });
}

test("usable at 360 px without horizontal page scroll", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/");
  await expectNoHorizontalScroll(page);
  await devLogin(page);
  await expectNoHorizontalScroll(page);
  await page.goto("/app/evaluations/new");
  await expectNoHorizontalScroll(page);
  const report = await findReport(page);
  await expectNoHorizontalScroll(page);
  const evaluation = page.url().replace(/\/submissions$/, "");
  await page.goto(report);
  await expect(page.getByRole("heading", { name: "Scorecard" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.goto(`${evaluation}/leaderboard`);
  await expect(page.getByRole("table")).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.goto(`${evaluation}/setup/rubric`);
  await expectNoHorizontalScroll(page);
});
