import { expect, type Page } from "@playwright/test";

export async function devLogin(page: Page, email = "e2e@repojudge.local") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Name").fill("E2E Judge");
  await page.getByRole("button", { name: "Sign in as dev user" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

/** No horizontal page scroll (spec §11.1: usable from 360 px). */
export async function expectNoHorizontalScroll(page: Page) {
  await page.waitForLoadState("networkidle");
  const info = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const clipped = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement)
        if (getComputedStyle(p).overflowX !== "visible") return true;
      return false;
    };
    const culprit = [...document.querySelectorAll("body *")].find(
      (el) => el.getBoundingClientRect().right > w + 1 && !clipped(el),
    );
    const describe = (el: Element) => `${el.tagName}.${String((el as HTMLElement).className).slice(0, 60)}`;
    return {
      overflow: document.documentElement.scrollWidth - w,
      culprit: culprit
        ? `${describe(culprit)} < ${culprit.parentElement ? describe(culprit.parentElement) : ""} right=${Math.round(culprit.getBoundingClientRect().right)}`
        : null,
    };
  });
  expect(
    info.overflow,
    `${page.url()} scrolls horizontally by ${info.overflow}px (${info.culprit})`,
  ).toBeLessThanOrEqual(1);
}
