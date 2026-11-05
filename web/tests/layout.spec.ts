import { expect, test } from "@playwright/test";

const widths = [375, 414, 768, 1024, 1440];

for (const width of widths) {
  test(`no horizontal overflow and tappable controls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");

    const check = async (label: string) => {
      const m = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        iw: window.innerWidth,
        // text squeezed into a sliver (a card nested in a card, wrapping one letter per line) is a layout bug even with no overflow
        narrow: [...document.querySelectorAll<HTMLElement>("dl.facts dd, .note h3, .note .big")]
          .filter((e) => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().width < 90)
          .map((e) => `${e.textContent?.trim().slice(0, 20)} ${Math.round(e.getBoundingClientRect().width)}px`),
        small: [...document.querySelectorAll<HTMLElement>("button, a, label.btn, summary, select, input:not(.sr-only)")]
          .filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.height < 44;
          })
          .map((e) => `${e.textContent?.trim().slice(0, 24)} ${Math.round(e.getBoundingClientRect().height)}px`),
      }));
      expect(m.sw, `${label}: page is wider than the viewport`).toBeLessThanOrEqual(m.iw);
      expect(m.small, `${label}: tap targets under 44px`).toEqual([]);
      expect(m.narrow, `${label}: text squeezed into under 90px`).toEqual([]);
    };

    await check("empty state");
    await page.getByRole("button", { name: "NIC sample QR" }).click();
    await expect(page.getByText(/Signature verified|already financed/).first()).toBeVisible({ timeout: 30_000 });
    await check("verified panel");
    await page.getByRole("button", { name: "Change one byte" }).click();
    await expect(page.getByText("Refused: the signature does not match")).toBeVisible({ timeout: 30_000 });
    await check("refusal panel");

    for (const role of ["Investor", "Debtor", "Attester", "Supplier"]) {
      await page.getByRole("tab", { name: new RegExp(role) }).click();
      await expect(page.locator(".wallet")).toBeVisible();
      if (role === "Investor") await expect(page.locator("#h-market ~ .notes .note, #h-market ~ div .note").first()).toBeVisible({ timeout: 60_000 }); // the marketplace, read from Arkiv
      if (role !== "Attester") await expect(page.locator(".note").first()).toBeVisible({ timeout: 30_000 });
      else await expect(page.getByText("Issue an investor credential")).toBeVisible();
      await check(`${role} view`);
    }
  });
}
