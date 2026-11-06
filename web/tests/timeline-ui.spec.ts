import { expect, test } from "@playwright/test";

// Reads real notes already on Whitechain Sepolia (made by earlier lifecycle runs); nothing is mocked.
test("a note's history opens from the chain's own events, with explorer links, and does not overflow at 375 px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/?reads=direct#app");
  const note = page.locator(".note").first();
  await expect(note).toBeVisible({ timeout: 60_000 });
  await note.locator("details.history summary").click();
  const first = note.locator("ol.timeline li").first();
  await expect(first).toBeVisible({ timeout: 90_000 });
  await expect(note.locator("ol.timeline li strong").first()).toHaveText(/Invoice verified and recorded|Note created/);
  await expect(first.locator("a[href*='/tx/']")).toHaveCount(1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
