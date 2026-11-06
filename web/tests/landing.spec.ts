import { expect, test } from "@playwright/test";

const widths = [375, 414, 768, 1024, 1440];

for (const width of widths) {
  test(`front page has no horizontal overflow and big enough tap targets at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?reads=direct");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Finance the invoice");
    await page.getByRole("heading", { name: /From a paper invoice/ }).scrollIntoViewIfNeeded();
    const m = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      iw: window.innerWidth,
      small: [...document.querySelectorAll<HTMLElement>("button, a, label.icon-btn, input:not(.sr-only), textarea")]
        .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height < 44; })
        .map((e) => `${(e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 24)} ${Math.round(e.getBoundingClientRect().height)}px`),
    }));
    expect(m.sw, "page is wider than the viewport").toBeLessThanOrEqual(m.iw);
    expect(m.small, "tap targets under 44px").toEqual([]);
  });
}

test("the front page's example opens the app and the contract checks it", async ({ page }) => {
  await page.goto("/?reads=direct");
  await page.getByRole("button", { name: "NIC sample QR" }).click();
  await expect(page).toHaveURL(/#app$/);
  await expect(page.getByRole("tab", { name: /Supplier/ })).toBeVisible();
  await expect(page.locator(".stamp").first()).toHaveText(/Verified|Already financed/, { timeout: 30_000 });
});

test("the app has a tab bar and the brand link goes back to the front page", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/?reads=direct#app");
  const tabs = page.getByRole("tablist", { name: "Choose a role" });
  await expect(tabs).toBeVisible();
  const box = await tabs.boundingBox();
  expect(box!.y + box!.height, "tab bar sits at the bottom of the phone screen").toBeGreaterThan(740);
  await page.getByRole("link", { name: "Khata home" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Finance the invoice");
});

for (const width of widths) {
  test(`the skyline illustration is shown whole, never cropped, at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?reads=direct");
    const m = await page.evaluate(() => {
      const c = document.querySelector(".sky-cluster")!.getBoundingClientRect();
      const s = document.querySelector(".skyline")!.getBoundingClientRect();
      return { cl: c.left, cr: c.right, ct: c.top, cb: c.bottom, sl: s.left, sr: s.right, st: s.top, sb: s.bottom, iw: window.innerWidth };
    });
    expect(m.cl, "left edge inside the page").toBeGreaterThanOrEqual(-0.5);
    expect(m.cr, "right edge inside the page").toBeLessThanOrEqual(m.iw + 0.5);
    expect(m.ct).toBeGreaterThanOrEqual(m.st - 0.5);
    expect(m.cb).toBeLessThanOrEqual(m.sb + 0.5);
  });
}

test("with reduced motion the sky and train stand still", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto("/?reads=direct");
  const names = await page.evaluate(() => [".cloud.a", ".flock", ".train", ".sway"].map((q) => getComputedStyle(document.querySelector(q)!).animationName));
  expect(names).toEqual(["none", "none", "none", "none"]);
  await ctx.close();
});
