// Verifying an Arkiv credential: a failed Whitechain read is that credential's problem, not a reason to drop all of Arkiv.
import { expect, test } from "@playwright/test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { verifyCredential, type CredentialRecord } from "../src/arkiv";
import { ELIGIBILITY_TYPES } from "../src/eip712";

const attester = privateKeyToAccount(generatePrivateKey());
const domain = { name: "KhataAttesters", version: "1", chainId: 1874, verifyingContract: "0x5faD73a64C1822266A646aD3957449d8BaC8491c" } as const;

async function signed(): Promise<CredentialRecord> {
  const m = { subject: "0x54E2221e61E436D7FF101640CF1edCC983dd75A5", tier: 2, jurisdiction: 356, validUntil: 2_000_000_000n, credId: ("0x" + "cd".repeat(32)) as `0x${string}` } as const;
  const signature = await attester.signTypedData({ domain, types: ELIGIBILITY_TYPES, primaryType: "Eligibility", message: m });
  return { entityKey: "0x01", owner: attester.address, attester: attester.address, subject: m.subject, tier: m.tier, jurisdiction: m.jurisdiction, validUntil: Number(m.validUntil), credId: m.credId, signature } as CredentialRecord;
}

test("a credential whose attester check cannot be read is marked unconfirmed, and nothing throws", async () => {
  const v = await verifyCredential(await signed(), { domain, now: 1_800_000_000, isAttester: async () => { throw new Error("RPC down"); } });
  expect(v.ok).toBe(false);
  expect(v.ok ? "" : v.reason).toMatch(/could not confirm/);
});

test("a good credential from an accepted attester verifies", async () => {
  expect((await verifyCredential(await signed(), { domain, now: 1_800_000_000, isAttester: async () => true })).ok).toBe(true);
});
