// The attester messages the app signs (web/src/eip712.ts, hashed by viem) must hash to the same EIP-712 digests the
// contract computes. Foundry checks the contract against the same fixed values in contracts/test/Eip712Golden.t.sol, so a
// typehash or field-order mismatch between the app and the contract fails offline, not only on a live run.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { hashTypedData } from "viem";
import { ELIGIBILITY_TYPES, REVOCATION_TYPES, SELLER_BINDING_TYPES } from "../src/eip712";

const golden = JSON.parse(readFileSync(new URL("../../contracts/test/fixtures/eip712-golden.json", import.meta.url), "utf8"));
const domain = { name: "KhataAttesters", version: "1", chainId: 1874, verifyingContract: golden.verifyingContract } as const;
const credId = ("0x" + "ab".repeat(32)) as `0x${string}`;

test("the app's typed data hashes to the digests the contract computes", () => {
  expect(hashTypedData({ domain, types: ELIGIBILITY_TYPES, primaryType: "Eligibility", message: { subject: "0x54E2221e61E436D7FF101640CF1edCC983dd75A5", tier: 2, jurisdiction: 356, validUntil: 1900000000n, credId } })).toBe(golden.eligibility);
  expect(hashTypedData({ domain, types: SELLER_BINDING_TYPES, primaryType: "SellerBinding", message: { gstinHash: ("0x" + "cd".repeat(32)) as `0x${string}`, wallet: "0xa03d3c24469DD58EAE3AE230781f293850A7686b", validUntil: 1900000000n, version: 7n } })).toBe(golden.sellerBinding);
  expect(hashTypedData({ domain, types: REVOCATION_TYPES, primaryType: "Revocation", message: { credId } })).toBe(golden.revocation);
});
