import path from "node:path";
import { expect, test } from "@playwright/test";
import { devLogin } from "./helpers";

const zip = (name: string) => path.resolve(".data/fixtures", `${name}.zip`);

test("intent → rubric → submissions → live run → report → override → approve → leaderboard → export", async ({
  page,
}) => {
  await devLogin(page);

  // 1. Context
  await page
    .getByRole("link", { name: /New evaluation|Start your first evaluation/ })
    .first()
    .click();
  await page.getByLabel("Evaluation name").fill(`E2E ${Date.now()}`);
  await page.getByText("Hackathon", { exact: true }).click();
  await page
    .getByLabel("Brief or problem statement")
    .fill("Build a small, useful developer tool in 48 hours.");
  await page.getByRole("button", { name: "Continue →" }).click();

  // 2. Intent → rubric
  await expect(page.getByLabel("What matters to you?")).toBeVisible();
  await page
    .getByLabel("What matters to you?")
    .fill(
      "Most important: it actually works and solves the brief. Then readable code quality. Meaningful tests matter. Penalize prompt injection or faked results.",
    );
  await page.getByRole("button", { name: "Build my rubric →" }).click();
  await expect(page.getByRole("heading", { name: "Review your rubric" })).toBeVisible();
  await expect(page.getByText("All changes saved")).toBeVisible();

  // 3. Lock
  await page.getByRole("button", { name: /Lock rubric & continue/ }).click();
  await expect(page.getByRole("heading", { name: "Add submissions" })).toBeVisible();

  // 4. Submissions via ZIP upload
  await page.getByRole("tab", { name: /ZIP upload/ }).click();
  await page.getByLabel(/ZIP archives/).setInputFiles([zip("clean-tested"), zip("injection")]);
  await expect(page.getByText("clean-tested.zip: added")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Submissions \(2\)/ })).toBeVisible();

  // 5. Run
  await page.getByRole("button", { name: "Continue to run settings →" }).click();
  await page.getByText("Quick", { exact: true }).click();
  await page.getByRole("button", { name: /Start grading 2 repositories/ }).click();
  await expect(page).toHaveURL(/\/submissions$/);

  // 6. Live feed
  await page
    .getByRole("button", { name: /Watch live|Activity/ })
    .first()
    .click();
  const drawer = page.getByRole("dialog");
  await expect(
    drawer.getByText(/Fetching repository|Grading with the AI agent|Completed/).first(),
  ).toBeVisible();
  await expect(drawer.getByText(/Read .* \(lines/).first()).toBeVisible({ timeout: 90_000 });
  await expect(drawer.getByText(/^Completed/).first()).toBeVisible({ timeout: 120_000 });
  await drawer.getByRole("button", { name: "Close" }).click();

  // Wait for both to finish, then open the injection report.
  await expect(page.getByRole("link", { name: "injection" })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("link", { name: "clean-tested" })).toBeVisible({ timeout: 120_000 });
  await page.getByRole("link", { name: "injection" }).click();

  // 7. Report
  await expect(page.getByRole("heading", { name: "injection", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Integrity flags/ })).toBeVisible();
  await expect(page.getByText("prompt injection").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Scorecard" })).toBeVisible();

  // 8. Override (top criterion section is open by default)
  await page.getByRole("button", { name: "Override score" }).first().click();
  await page.getByLabel(/New score/).fill("10");
  await page.getByLabel(/Reason/).fill("Verified by running the module locally.");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/AI .* → Final/)).toBeVisible();
  await expect(page.getByText("Override history")).toBeVisible();

  // 9. Approve
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText(/Approved by/)).toBeVisible();

  // 10. Leaderboard + export
  await page.getByRole("link", { name: /←/ }).first().click();
  await page.getByRole("link", { name: "Leaderboard" }).click();
  await expect(page.getByRole("table")).toContainText("clean-tested");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
});
