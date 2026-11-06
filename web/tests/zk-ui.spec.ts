// Live: the supplier binds a demo invoice by zero-knowledge proof, made in the browser, on Whitechain Sepolia.
// Uses real transactions from the supplier demo wallet (needs the dev server's signer keys in .env) and one unused demo invoice.
import { expect, test } from "@playwright/test";

test.setTimeout(420_000);
test.use({ baseURL: "http://127.0.0.1:4173" }); // the production build: the prover does not run under the dev server

test("the supplier finances a demo invoice with a proof made in the browser, and the chain records no IRN", async ({ page }) => {
  const posted: string[] = [];
  page.on("request", (r) => { if (r.method() === "POST") posted.push(r.postData() ?? ""); });
  await page.setViewportSize({ width: 1024, height: 1000 });
  await page.goto("/?reads=direct#app");
  await page.getByRole("button", { name: "DEMO IRP invoice" }).click();
  await expect(page.getByText("Verified", { exact: true })).toBeVisible({ timeout: 90_000 });
  const irn = (await page.locator(".mono").filter({ hasText: /^[0-9a-f]{64}$/ }).first().textContent())!.trim();

  await page.getByTestId("finance-private").click();
  await expect(page.getByText("Making a private proof")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Invoice bound by proof")).toBeVisible({ timeout: 360_000 });
  await expect(page.locator(".stamp.warn", { hasText: "Already financed" })).toBeVisible({ timeout: 60_000 });

  // the signed transaction that was broadcast carries the proof, not the invoice
  const sent = posted.filter((b) => b.includes("eth_sendRawTransaction"));
  expect(sent.length).toBeGreaterThan(0);
  for (const b of sent) expect(b.toLowerCase()).not.toContain(irn.toLowerCase());
});
