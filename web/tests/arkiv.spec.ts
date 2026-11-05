// Live tests against Arkiv's Rabdi testnet and Whitechain Sepolia, with the labelled demo wallets.
// Needs ARKIV_ACCESS_KEY and the demo keys in the ignored .env, and tGLM on the attester and supplier addresses.
import { expect, test } from "@playwright/test";
import { http, keccak256, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createServer } from "node:http";
// @ts-expect-error plain ESM helper shared with the live scripts
import { clients, deployment, loadEnv, wallet } from "../../scripts/lib/chain.mjs";
import {
  arkivClients, ArkivUnavailable, arkivError, Credential, extendListing, findAllCredentials, watchArkiv, findCredentials, findListings, findRevocations, publishCredential, publishListing,
  publishRevocation, setListingStatus, verifyCredential, verifyListing, verifyRevocation, type CredentialRecord,
} from "../src/arkiv";
import { ELIGIBILITY_TYPES, REVOCATION_TYPES } from "../src/eip712";
import { readFileSync } from "node:fs";
const readAbi = (f: string) => JSON.parse(readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8"));
const attestersAbi = readAbi("attesters-abi.json");
const factoryAbi = readAbi("factory-abi.json");
const noteAbi = readAbi("note-abi.json");

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const env = loadEnv();
const dep = deployment().stage2;
const { publicClient } = clients();
const ark = arkivClients({ accessKey: env.ARKIV_ACCESS_KEY });
const attester = wallet("ATTESTER");
const supplier = wallet("SUPPLIER");
const investor = wallet("INVESTOR");
const attesterArk = ark.wallet(attester.account);
const supplierArk = ark.wallet(supplier.account);
const domain = { name: "KhataAttesters", version: "1", chainId: 1874, verifyingContract: dep.AttesterRegistry } as const;
const isAttester = async (a: Address) => (await publicClient.readContract({ address: dep.AttesterRegistry, abi: attestersAbi, functionName: "isAttester", args: [a] })) as boolean;
const chainNow = async () => Number((await publicClient.getBlock()).timestamp);
const nowSec = () => Math.floor(Date.now() / 1000);
const stamp = Date.now().toString(16);
const credIdFor = (tag: string) => keccak256(toHex(`${tag}:${stamp}`)) as Hex;

async function signCred(subject: Address, validUntil: number, credId: Hex, tier = 2) {
  const message = { subject, tier, jurisdiction: 356, validUntil: BigInt(validUntil), credId };
  const signature = await attester.client.signTypedData({ domain, types: ELIGIBILITY_TYPES, primaryType: "Eligibility", message });
  return { subject, attester: attester.account.address as Address, tier, jurisdiction: 356, validUntil, credId, signature };
}
const waitFor = async <T>(f: () => Promise<T | undefined>, ms = 60_000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting for Arkiv");
    await new Promise((r) => setTimeout(r, 2000));
  }
};

test("a credential written by the attester is read back, owned by the attester, and verifies", async () => {
  const validUntil = nowSec() + 3600;
  const c = await signCred(investor.account.address, validUntil, credIdFor("roundtrip"));
  const { entityKey } = await publishCredential(attesterArk, c);
  const found = await waitFor(async () => (await findCredentials(ark.pub, { subject: c.subject, notBefore: nowSec() })).find((x) => x.entityKey === entityKey));
  expect(found.owner.toLowerCase()).toBe(attester.account.address.toLowerCase());
  expect(found.credId).toBe(c.credId);
  expect(found.tier).toBe(2);
  expect(found.validUntil).toBe(validUntil);
  expect(await verifyCredential(found, { domain, isAttester, now: await chainNow() })).toEqual({ ok: true });
});

test("a forged credential is rejected: wrong signer, wrong owner, untrusted attester, expired", async () => {
  const subject = investor.account.address as Address;
  const base = await signCred(subject, nowSec() + 3600, credIdFor("forge"));
  const now = await chainNow();
  const rec = (over: Partial<CredentialRecord> = {}): CredentialRecord => ({ entityKey: "0x00" as Hex, owner: attester.account.address, ...base, ...over });

  // tampered tier: the signature no longer matches the stated attester
  const tampered = await verifyCredential(rec({ tier: 9 }), { domain, isAttester, now });
  expect(tampered.ok).toBe(false);
  // right signature, but published by another wallet (the supplier copying the attester's signature)
  const copied = await verifyCredential(rec({ owner: supplier.account.address }), { domain, isAttester, now });
  expect(copied).toMatchObject({ ok: false, reason: expect.stringContaining("someone other than the attester") });
  // a self-signed credential from a wallet Whitechain does not accept
  const rogue = privateKeyToAccount(`0x${"ab".repeat(32)}`);
  const message = { subject, tier: 2, jurisdiction: 356, validUntil: BigInt(nowSec() + 3600), credId: credIdFor("rogue") };
  const signature = await rogue.signTypedData({ domain, types: ELIGIBILITY_TYPES, primaryType: "Eligibility", message });
  const rogueRec = rec({ attester: rogue.address, owner: rogue.address, signature, credId: message.credId, validUntil: Number(message.validUntil) });
  expect(await verifyCredential(rogueRec, { domain, isAttester, now })).toMatchObject({ ok: false, reason: expect.stringContaining("not an attester") });
  // expired
  const expired = await signCred(subject, now - 10, credIdFor("old"));
  expect(await verifyCredential(rec({ ...expired }), { domain, isAttester, now })).toMatchObject({ ok: false, reason: expect.stringContaining("expired") });
});

test("only the owner can change an entity: another wallet's patch, extend and delete are all refused", async () => {
  const c = await signCred(investor.account.address, nowSec() + 1800, credIdFor("owner-only"));
  const { entityKey } = await publishCredential(attesterArk, c);
  const { ExpirationTime } = await import("@arkiv-network/sdk");
  const { u64 } = await import("@arkiv-network/sdk/schema");
  await expect(supplierArk.deleteEntity({ entityKey })).rejects.toThrow(/is owned by/);
  await expect(supplierArk.extendEntity({ entityKey, expiration: ExpirationTime.fromHours(1) } as any)).rejects.toThrow(/is owned by/);
  await expect(supplierArk.patchEntity(Credential, entityKey, { set: { tier: u64(9) } })).rejects.toThrow(/is owned by/);
  const rows = await waitFor(async () => { const r = (await findCredentials(ark.pub, { subject: c.subject, notBefore: nowSec() })).filter((x) => x.entityKey === entityKey); return r.length ? r : undefined; });
  expect(rows[0].tier).toBe(2); // untouched
});

test("an entity disappears from queries after it expires", async () => {
  const c = await signCred(investor.account.address, nowSec() + 30, credIdFor("short"));
  const { entityKey } = await publishCredential(attesterArk, c);
  await waitFor(async () => (await findCredentials(ark.pub, { subject: c.subject, notBefore: nowSec() })).find((x) => x.entityKey === entityKey));
  // validUntil is 30 s away and the minimum lifetime is 10 s, so the entity should be gone within about a minute
  await waitFor(async () => ((await findCredentials(ark.pub, { subject: c.subject, notBefore: 0, limit: 100 })).some((x) => x.entityKey === entityKey) ? undefined : true), 120_000);
});

test("range queries and key pagination return every match exactly once", async () => {
  const subject = investor.account.address as Address;
  const seen = new Set<string>();
  const first = await findCredentials(ark.pub, { subject, notBefore: nowSec(), limit: 1 });
  expect(first.length).toBeLessThanOrEqual(1);
  const all = await findCredentials(ark.pub, { subject, notBefore: nowSec(), limit: 100 });
  for (const r of all) {
    expect(seen.has(r.entityKey)).toBe(false);
    seen.add(r.entityKey);
  }
  // ordered by expiry ascending
  for (let i = 1; i < all.length; i++) expect(all[i].validUntil).toBeGreaterThanOrEqual(all[i - 1].validUntil);
  // a range that excludes everything
  expect(await findCredentials(ark.pub, { subject, notBefore: nowSec() + 10 * 365 * 86400 })).toEqual([]);
});

test("a revocation signed and published by the attester verifies; one published by someone else does not", async () => {
  const credId = credIdFor("revoke");
  const signature = await attester.client.signTypedData({ domain, types: REVOCATION_TYPES, primaryType: "Revocation", message: { credId } });
  const { entityKey } = await publishRevocation(attesterArk, { attester: attester.account.address, credId, signature }, nowSec() + 3600);
  const rows = await waitFor(async () => { const r = await findRevocations(ark.pub, { attester: attester.account.address, credId }); return r.length ? r : undefined; });
  expect(rows[0].entityKey).toBe(entityKey);
  expect(await verifyRevocation(rows[0], { domain })).toEqual({ ok: true });
  expect(await verifyRevocation({ ...rows[0], owner: supplier.account.address }, { domain })).toMatchObject({ ok: false });
});

test("Arkiv outages become a readable error, not a raw dump", async () => {
  const dead = arkivClients({ transport: http("http://127.0.0.1:9", { timeout: 2000, retryCount: 0 }) });
  const err = await findCredentials(dead.pub, { subject: investor.account.address, notBefore: nowSec() }).catch((e) => e);
  expect(err).toBeInstanceOf(ArkivUnavailable);
  expect(err.why).toMatch(/Arkiv did not answer in time|refused/);
});

test("listings: the seller's listing for a real note verifies; a stranger's listing for the same note does not; status is the owner's to patch", async () => {
  // use the newest real note on Whitechain
  const { createPublicClient } = await import("viem");
  const head = await publicClient.getBlockNumber();
  const logs = (await publicClient.getContractEvents({ address: dep.KhataFactory, abi: factoryAbi, eventName: "NoteCreated", fromBlock: head - 9000n, toBlock: head } as any)) as any[];
  expect(logs.length, "needs at least one note created in the last 9000 blocks; run the live UI test first").toBeGreaterThan(0);
  const { note, nullifier, seller, faceValue, dueDate } = logs[logs.length - 1].args;
  const noteSeller = async (n: Address) => (await publicClient.readContract({ address: n, abi: noteAbi, functionName: "seller" })) as Address;
  const factoryNoteOf = async (nl: Hex) => (await publicClient.readContract({ address: dep.KhataFactory, abi: factoryAbi, functionName: "noteOf", args: [nl] })) as Address;
  const ctx = { factoryNoteOf, noteSeller };
  const base = { note, seller, nullifier, faceValue: BigInt(faceValue), discountBps: 500, dueDate: Number(dueDate), minTier: 1, status: "open", title: `test listing ${stamp}` };
  const { entityKey } = await publishListing(supplierArk, base, 600);
  const rows = await waitFor(async () => { const r = await findListings(ark.pub, { dueAfter: 0, seller }); const m = r.filter((x) => x.entityKey === entityKey); return m.length ? m : undefined; });
  expect(await verifyListing(rows[0], ctx)).toEqual({ ok: true });
  // the same listing text published by the attester wallet (not the seller)
  const fake = await publishListing(attesterArk, base, 600);
  const fakeRows = await waitFor(async () => { const r = await findListings(ark.pub, { dueAfter: 0 }); const m = r.filter((x) => x.entityKey === fake.entityKey); return m.length ? m : undefined; });
  expect(await verifyListing(fakeRows[0], ctx)).toMatchObject({ ok: false, reason: expect.stringContaining("someone other than the seller") });
  // a listing that points at a note the factory did not make for that invoice
  const wrongNote = { ...rows[0], note: factoryAbi && ("0x000000000000000000000000000000000000dEaD" as Address) };
  expect(await verifyListing(wrongNote, ctx)).toMatchObject({ ok: false, reason: expect.stringContaining("not the one Khata created") });
  // owner patches the status; a stranger cannot
  await setListingStatus(supplierArk, entityKey, "closed");
  const closed = await waitFor(async () => (await findListings(ark.pub, { dueAfter: 0, status: "closed", seller })).find((x) => x.entityKey === entityKey));
  expect(closed.status).toBe("closed");
  await expect(setListingStatus(attesterArk, entityKey, "open")).rejects.toThrow();
  void createPublicClient;
});

test("end to end: a credential found on Arkiv is submitted to Whitechain by the investor and makes the wallet eligible", async () => {
  const subject = investor.account.address as Address;
  const validUntil = (await chainNow()) + 1800;
  const c = await signCred(subject, validUntil, credIdFor("e2e"));
  const { entityKey } = await publishCredential(attesterArk, c);
  const found = await waitFor(async () => (await findCredentials(ark.pub, { subject, notBefore: nowSec() })).find((x) => x.entityKey === entityKey));
  expect(await verifyCredential(found, { domain, isAttester, now: await chainNow() })).toEqual({ ok: true });
  // the investor, not the attester, pays for activation on Whitechain
  const hash = await investor.client.writeContract({
    address: dep.AttesterRegistry, abi: attestersAbi as never, functionName: "register",
    args: [{ subject: found.subject, tier: found.tier, jurisdiction: found.jurisdiction, validUntil: BigInt(found.validUntil), credId: found.credId }, found.signature], gas: 300_000n,
  } as any);
  await publicClient.waitForTransactionReceipt({ hash });
  const [reason] = (await publicClient.readContract({ address: dep.AttesterRegistry, abi: attestersAbi, functionName: "eligibility", args: [subject] })) as [number, number];
  expect(reason).toBe(0); // Eligible
});

test("key-cursor paging reads every match exactly once, even while someone else writes", async () => {
  const subject = privateKeyToAccount(generatePrivateKey()).address; // fresh wallet: nothing else matches it
  const written: string[] = [];
  for (let i = 0; i < 3; i++) written.push((await publishCredential(attesterArk, await signCred(subject, nowSec() + 3600, credIdFor(`page${i}`)))).entityKey);
  await waitFor(async () => ((await findCredentials(ark.pub, { subject, notBefore: nowSec() })).length === 3 ? true : undefined));

  const pages: string[][] = [];
  let wroteDuringPaging = false;
  const all = await findAllCredentials(ark.pub, {
    subject, notBefore: nowSec(), pageSize: 1,
    onPage: async (p) => {
      pages.push(p.map((x) => x.entityKey));
      if (!wroteDuringPaging) { // a write lands between two page requests
        wroteDuringPaging = true;
        written.push((await publishCredential(attesterArk, await signCred(subject, nowSec() + 3600, credIdFor("page-late")))).entityKey);
      }
    },
  });
  const keys = all.map((x) => x.entityKey);
  expect(new Set(keys).size, "no row is returned twice").toBe(keys.length);
  for (const k of written.slice(0, 3)) expect(keys, "no row that existed before paging began is missed").toContain(k);
  expect(pages.length).toBeGreaterThanOrEqual(3);
  expect(pages.every((p) => p.length <= 1)).toBe(true);
  expect(keys).toEqual([...keys].sort()); // cursor order is by key, ascending
});

test("a rate limit (HTTP 429) becomes a readable message that says what to do", async () => {
  const server = createServer((_req, res) => { res.writeHead(429, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "Too Many Requests" })); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  try {
    const limited = arkivClients({ transport: http(`http://127.0.0.1:${port}`, { retryCount: 0, timeout: 3000 }) });
    const err = await findCredentials(limited.pub, { subject: investor.account.address, notBefore: nowSec() }).catch((e) => e);
    expect(err).toBeInstanceOf(ArkivUnavailable);
    expect(err.why).toMatch(/rate limiting/);
    expect(err.why).toMatch(/access key/);
  } finally { server.close(); }
  expect(arkivError(new Error("HTTP request failed. Status: 429")).why).toMatch(/rate limiting/);
});

test("watchEntityEvents tells the page about a new entity without polling", async () => {
  const events: string[] = [];
  const stop = watchArkiv(ark.pub, (type) => events.push(type));
  try {
    await publishCredential(attesterArk, await signCred(investor.account.address, nowSec() + 600, credIdFor("watch")));
    await waitFor(async () => (events.includes("EntityCreated") ? true : undefined), 30_000);
  } finally { stop(); }
});

test("a listing can be extended by its owner only, and the new expiry is later", async () => {
  const head = await publicClient.getBlockNumber();
  const logs = (await publicClient.getContractEvents({ address: dep.KhataFactory, abi: factoryAbi, eventName: "NoteCreated", fromBlock: head - 9000n, toBlock: head } as any)) as any[];
  expect(logs.length).toBeGreaterThan(0);
  const { note, nullifier, seller, faceValue, dueDate } = logs[logs.length - 1].args;
  const base = { note, seller, nullifier, faceValue: BigInt(faceValue), discountBps: 500, dueDate: Number(dueDate), minTier: 1, status: "open", title: `extend test ${stamp}` };
  const created = await publishListing(supplierArk, base, 0);
  const extended = await extendListing(supplierArk, created.entityKey, 3600);
  expect(extended.expiresAt).toBeGreaterThan(created.expiresAt);
  await expect(extendListing(attesterArk, created.entityKey, 3600)).rejects.toThrow(/owned by|refused/);
});
