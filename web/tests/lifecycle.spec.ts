// End to end through the real UI against the live Whitechain Sepolia deployment, with the labelled demo wallets.
// Needs the demo keys in the ignored .env. Takes about six minutes because the cool-off and due date are real.
import { expect, test } from "@playwright/test";
import { parseAbi } from "viem";
// @ts-expect-error plain ESM helper shared with the live scripts
import { clients, wallet, deployment } from "../../scripts/lib/chain.mjs";

test.setTimeout(14 * 60_000);

// The debtor pays the invoice face value in the prize USDT, so make sure that wallet can: move USDT from the supplier.
test.beforeAll(async () => {
  const usdt = deployment().stage2.usdt;
  const abi = parseAbi(["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)"]);
  const { publicClient } = clients();
  const debtor = wallet("DEBTOR").account.address;
  const want = 4_300_000n;
  const have = (await publicClient.readContract({ address: usdt, abi, functionName: "balanceOf", args: [debtor] })) as bigint;
  if (have >= want) return;
  const supplier = wallet("SUPPLIER");
  const hash = await supplier.client.writeContract({ address: usdt, abi, functionName: "transfer", args: [debtor, want - have], gas: 200_000n });
  await publicClient.waitForTransactionReceipt({ hash });
});

test("full lifecycle through the four role views on the real chain", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 1000 });
  await page.goto("/");

  // ---- supplier: scan a demo invoice, verify on-chain, register, create the note ----
  await page.getByRole("button", { name: "DEMO IRP invoice" }).click();
  await expect(page.getByText("Verified", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("DEMO IRP (not government)").first()).toBeVisible();
  await page.getByRole("button", { name: "Finance this invoice" }).click();
  await expect(page.getByText("Invoice bound on-chain")).toBeVisible({ timeout: 90_000 });

  await page.getByLabel("Due in").fill("4");
  await page.getByLabel("Grace after due date (minutes)").fill("1");
  await page.getByRole("button", { name: "Create the note" }).click();
  await expect(page.getByText("Note created")).toBeVisible({ timeout: 90_000 });
  // the page re-reads the chain after the transaction; the new note is the one still in its cool-off
  const fresh = page.locator(".note", { hasText: "Cool-off" }).first();
  await expect(fresh).toBeVisible({ timeout: 60_000 });
  const noteName = (await fresh.locator("h3").textContent())!.trim();
  expect(noteName).toMatch(/^Khata note 0x/);

  // ---- attester: issue a credential to investor A ----
  await page.getByRole("tab", { name: /Attester/ }).click();
  await page.getByLabel("Valid for").fill("30");
  await page.getByRole("button", { name: "Sign and register" }).first().click();
  await expect(page.getByText("Credential issued and registered")).toBeVisible({ timeout: 90_000 });

  // ---- investor: wait for the cool-off, fund with one signature, see a readable block ----
  await page.getByRole("tab", { name: /Investor/ }).click();
  const card = page.locator(".note", { hasText: noteName }).first();
  await expect(card.getByText("Open for funding")).toBeVisible({ timeout: 150_000 });
  await card.getByLabel("Amount of notes").first().fill("0.5");
  await card.getByRole("button", { name: "Buy with one signature" }).click();
  await expect(card.getByText("Funded in one transaction")).toBeVisible({ timeout: 120_000 });
  await expect(card.getByText("0.50 notes")).toBeVisible();

  await card.getByText("Send notes to another wallet").click();
  await card.getByLabel("Send to").selectOption({ label: "Debtor (demo) (no valid credential)" });
  await card.getByRole("button", { name: "Check the rules" }).click();
  await expect(card.getByText("This transfer would be blocked")).toBeVisible();
  // the debtor wallet may have no credential, or one that earlier runs revoked or let expire: any readable reason will do
  await expect(card.getByText(/^The receiver('s credential| has no credential)/)).toBeVisible();
  await card.getByRole("button", { name: "Send", exact: true }).click();
  await expect(card.getByText("Blocked: the receiver has no valid credential")).toBeVisible({ timeout: 60_000 });

  // ---- debtor: pay once it is due ----
  await page.getByRole("tab", { name: /Debtor/ }).click();
  const dcard = page.locator(".note", { hasText: noteName }).first();
  const pay = dcard.getByRole("button", { name: /^Pay / });
  await expect(pay).toBeEnabled({ timeout: 6 * 60_000 });
  await pay.click();
  await expect(dcard.getByText("Invoice paid and settled")).toBeVisible({ timeout: 150_000 });

  // ---- investor: redeem ----
  await page.getByRole("tab", { name: /Investor/ }).click();
  const icard = page.locator(".note", { hasText: noteName }).first();
  await expect(icard.getByText("Settled", { exact: true })).toBeVisible({ timeout: 60_000 });
  await icard.getByRole("button", { name: /^Redeem / }).click();
  await expect(icard.getByText(/Redeemed 0\.50 USDT/)).toBeVisible({ timeout: 90_000 });
});
