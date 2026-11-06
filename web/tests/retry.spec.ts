// A first load that hits a transient RPC failure should recover on its own instead of leaving the visitor on an error.
import { expect, test } from "@playwright/test";

test("a load that fails on the RPC more than once loads on its own, and only shows an error if it keeps failing", async ({ page }) => {
  let failed = 0;
  await page.route("**/rpc.testnet.whitechain.io/**", async (route) => {
    if (failed < 3) { failed++; return route.abort("failed"); }
    return route.continue();
  });
  await page.goto("/?reads=direct#app");
  await page.getByRole("tab", { name: /Investor/ }).click();
  // quicker than the 30 s background poll: the first load retries itself after a few seconds
  await expect(page.locator(".note").first()).toBeVisible({ timeout: 15_000 });
  expect(failed).toBe(3);
  await expect(page.getByText("Could not read the chain")).toHaveCount(0);
});

test("a load that keeps failing shows the error with a retry button", async ({ page }) => {
  await page.route("**/rpc.testnet.whitechain.io/**", (route) => route.abort("failed"));
  await page.goto("/?reads=direct#app");
  await expect(page.getByText("Could not read the chain")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});
