// Which Arkiv credential to offer an investor for activation: the longest-lived one that is verified and not revoked.
import { expect, test } from "@playwright/test";
import { pickActivatable, type CredentialRecord, type RevocationRecord } from "../src/arkiv";

const cred = (id: string, validUntil: number): { rec: CredentialRecord; ok: boolean } => ({
  ok: true,
  rec: { entityKey: `0x${id}` as `0x${string}`, owner: "0xA", subject: "0xS", attester: "0xA", tier: 2, validUntil, credId: `0x${id}`, jurisdiction: 356, signature: "0x00" } as CredentialRecord,
});
const rev = (id: string, ok = true): { rec: RevocationRecord; ok: boolean } => ({ ok, rec: { entityKey: "0x01", owner: "0xA", attester: "0xA", credId: `0x${id}` as `0x${string}`, signature: "0x00" } });

test("the longest-lived verified credential is chosen", () => {
  expect(pickActivatable([cred("aa", 100), cred("bb", 300), cred("cc", 200)], [])?.rec.credId).toBe("0xbb");
});
test("a credential the attester revoked is never offered, even if it lives longest", () => {
  expect(pickActivatable([cred("aa", 100), cred("bb", 300)], [rev("bb")])?.rec.credId).toBe("0xaa");
});
test("a revocation that does not verify does not hide a credential", () => {
  expect(pickActivatable([cred("aa", 100)], [rev("aa", false)])?.rec.credId).toBe("0xaa");
});
test("credentials that failed verification are never chosen, and nothing is chosen when nothing qualifies", () => {
  const bad = { ...cred("zz", 999), ok: false };
  expect(pickActivatable([bad, cred("aa", 100)], [])?.rec.credId).toBe("0xaa");
  expect(pickActivatable([bad], [])).toBeUndefined();
  expect(pickActivatable([cred("aa", 100)], [rev("aa")])).toBeUndefined();
});
