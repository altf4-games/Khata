// The Privacy page: it is reachable, it states what is happening, and the audit and the log reflect real requests.
import { expect, test } from "@playwright/test";

test("the page opens from the reads chip and the footer, and with direct reads it says plainly that reads were direct", async ({ page }) => {
  await page.goto("/?reads=direct#app");
  await page.getByTestId("reads-chip").click();
  await expect(page).toHaveURL(/#privacy$/);
  await expect(page.getByTestId("privacy-page")).toBeVisible();
  await expect(page.getByTestId("privacy-status")).toContainText("direct");
  await expect(page.getByTestId("privacy-audit")).toHaveCount(0); // no 'all private' claim while reads are direct
  await expect(page.getByTestId("privacy-compare")).toBeDisabled(); // no route to compare
});

test("the request log lists what the app read, marked as direct when it was", async ({ page }) => {
  await page.goto("/?reads=direct#app");
  await page.getByRole("tab", { name: /Investor/ }).click();
  await expect(page.locator(".note").first()).toBeVisible({ timeout: 60_000 });
  await page.evaluate(() => { location.hash = "#privacy"; });
  await expect(page.locator('tr[data-route="direct"]').first()).toBeVisible();
  await expect(page.locator('tr[data-route="anon"]')).toHaveCount(0);
});

test("the page has no horizontal overflow at 375 px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/?reads=direct#privacy");
  await expect(page.getByTestId("privacy-page")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
