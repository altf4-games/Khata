// The evidence page lists real transactions from the live suite and explains what Anon-RPC does and does not cover.
import { expect, test } from "@playwright/test";
import evidence from "../../deployments/evidence.json" with { type: "json" };

test("the evidence file holds unique, well-formed transaction hashes and both outcomes", () => {
  const hashes = evidence.entries.map((e) => e.hash);
  expect(new Set(hashes).size).toBe(hashes.length);
  for (const h of hashes) expect(h).toMatch(/^0x[0-9a-f]{64}$/);
  expect(evidence.entries.some((e) => e.status === "reverted")).toBe(true);
  expect(evidence.entries.some((e) => e.status === "success")).toBe(true);
  // a refusal is only evidence if the label says what was refused
  for (const e of evidence.entries.filter((x) => x.status === "reverted")) expect(e.label).toMatch(/refused/);
});

test("the page lists every refusal and success with an explorer link, and reads no Khata chain data", async ({ page }) => {
  const rpc: string[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && !r.url().includes("/api/")) rpc.push(r.url()); });
  await page.goto("/#evidence");
  await expect(page.getByRole("heading", { name: "What the contract refused" })).toBeVisible();
  const refused = evidence.entries.filter((e) => e.status === "reverted");
  await expect(page.locator("[data-refusal]")).toHaveCount(refused.length);
  await expect(page.locator("[data-success]")).toHaveCount(evidence.entries.length - refused.length);
  const first = page.locator("[data-refusal] a").first();
  expect(await first.getAttribute("href")).toMatch(/^https:\/\/explorer\.testnet\.whitechain\.io\/tx\/0x[0-9a-f]{64}$/);
  // the one worker-bootstrap read (Ethereum mainnet, no user data) is counted apart in the app; nothing reads Whitechain or Arkiv here
  const chainReads = rpc.filter((u) => !u.includes("ethereum-rpc.publicnode.com"));
  expect(chainReads, chainReads.join(" ")).toEqual([]);
});

test("the page says what Anon-RPC hides and what stays visible", async ({ page }) => {
  await page.goto("/#evidence");
  const t = page.getByRole("table", { name: "What Anon-RPC covers" });
  await expect(t).toBeVisible();
  await expect(t).toContainText("Reads");
  await expect(t).toContainText("Signed transactions");
  await expect(t).toContainText("Your IP address");
});

for (const width of [375, 414, 768, 1440]) {
  test(`the evidence page has no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/#evidence");
    await expect(page.getByRole("heading", { name: "What the contract refused" })).toBeVisible();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(0);
    const small = await page.evaluate(() => [...document.querySelectorAll("a, button")].filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 44; }).length);
    expect(small).toBe(0);
  });
}

test("the evidence keeps the one-time first bind of the NIC sample, and every refusal says why", () => {
  expect(evidence.entries.some((e) => /NIC sample/.test(e.label) && e.status === "success"), "a successful bind of the NIC sample").toBe(true);
  const unexplained = evidence.entries.filter((e) => e.status === "reverted" && !(e as { reason?: string }).reason).map((e) => e.label);
  expect(unexplained, "refusals with no recorded reason").toEqual([]);
});
