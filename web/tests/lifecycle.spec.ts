// End to end through the real UI against the live Whitechain Sepolia deployment, with the labelled demo wallets.
// Needs the demo keys in the ignored .env. Takes about six minutes because the cool-off and due date are real.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { http, parseAbi, type Address, type Hex } from "viem";
import { arkivClients, publishRevocation } from "../src/arkiv";
import { REVOCATION_TYPES } from "../src/eip712";
// @ts-expect-error plain ESM helper shared with the live scripts
import { clients, wallet, deployment, loadEnv } from "../../scripts/lib/chain.mjs";

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
  await page.goto("/?reads=direct#app");

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

  // the supplier publishes the listing on Arkiv
  await fresh.getByRole("button", { name: "List on the marketplace" }).click();
  await expect(page.getByText("Listed on Arkiv").first()).toBeVisible({ timeout: 120_000 });

  // ---- attester: sign a credential for investor A and publish it on Arkiv ----
  await page.getByRole("tab", { name: /Attester/ }).click();
  // longer than any credential left from earlier runs, so this one is the investor's best and needs activating
  await page.getByLabel("Valid for").fill("120");
  await page.getByRole("button", { name: "Sign and publish to Arkiv" }).click();
  await expect(page.getByText("Credential published on Arkiv")).toBeVisible({ timeout: 120_000 });

  // ---- investor: wait for the cool-off, fund with one signature, see a readable block ----
  await page.getByRole("tab", { name: /Investor/ }).click();
  // the investor finds the credential on Arkiv and registers it on Whitechain, paying their own fee
  const activate = page.getByRole("button", { name: "Activate on Whitechain" });
  await expect(activate).toBeVisible({ timeout: 120_000 });
  await activate.click();
  await expect(page.getByText("Credential activated")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText("Active on Whitechain")).toBeVisible({ timeout: 60_000 });
  // the listing shows in the marketplace, read from Arkiv and confirmed against the factory
  await expect(page.locator("#h-market")).toBeVisible();
  await expect(page.getByText("Listed on Arkiv").first()).toBeVisible({ timeout: 60_000 });
  // the filters are Arkiv queries: a 90% minimum discount excludes the 5% listing, a 0% minimum brings it back
  await page.getByLabel("Minimum discount (%)").fill("90");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByText("No listings match")).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("Minimum discount (%)").fill("0");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByText("Listed on Arkiv").first()).toBeVisible({ timeout: 60_000 });
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

  // ---- supplier: close funding; the Arkiv listing is patched to closed by its owner ----
  await page.getByRole("tab", { name: /Supplier/ }).click();
  const scard = page.locator(".note", { hasText: noteName }).first();
  await scard.getByRole("button", { name: "Close funding now" }).click();
  await expect(scard.getByText(/Funding closed\./)).toBeVisible({ timeout: 120_000 });
  await expect(scard.getByText("Listing closed")).toBeVisible({ timeout: 120_000 });

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

  // ---- the attester publishes a revocation on Arkiv only; the investor applies it to Whitechain ----
  const dep = deployment().stage2;
  const attester = wallet("ATTESTER");
  const investorAddr = wallet("INVESTOR").account.address as Address;
  const readAbi = (f: string) => JSON.parse(readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8"));
  const { publicClient } = clients();
  const cred = (await publicClient.readContract({ address: dep.AttesterRegistry, abi: readAbi("attesters-abi.json"), functionName: "credentialOf", args: [investorAddr] })) as readonly [Address, number, number, bigint, Hex];
  const credId = cred[4];
  const domain = { name: "KhataAttesters", version: "1", chainId: 1874, verifyingContract: dep.AttesterRegistry } as const;
  const signature = await attester.client.signTypedData({ domain, types: REVOCATION_TYPES, primaryType: "Revocation", message: { credId } });
  const ark = arkivClients({ accessKey: loadEnv().ARKIV_ACCESS_KEY, transport: http() });
  await publishRevocation(ark.wallet(attester.account), { attester: attester.account.address, credId, signature }, Number(cred[3]));

  await page.reload();
  await page.getByRole("tab", { name: /Investor/ }).click();
  await expect(page.getByText("The attester revoked this credential")).toBeVisible({ timeout: 120_000 });
  await page.getByRole("button", { name: "Apply the revocation on Whitechain" }).click();
  await expect(page.getByText("Revocation applied on Whitechain")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText("Whitechain says this wallet is not eligible (Revoked)")).toBeVisible({ timeout: 60_000 });
});
