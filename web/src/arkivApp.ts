// Arkiv as the app uses it: shared clients, and one loader that reads credentials, revocations and listings
// and checks each one before the views see it.
import type { Address, Hex } from "viem";
import { attesterDomain, attestersAbi, attestersAddress, factoryAbi, factoryAddress, noteAbi, publicClient } from "./chain";
import {
  arkivClients, findAllCredentials, findListings, findRevocations, watchArkiv, verifyCredential, verifyListing, verifyRevocation,
  type CredentialRecord, type ListingRecord, type RevocationRecord,
} from "./arkiv";
import { wallets } from "./wallets";
import { chainTransport } from "./anon";

const env = import.meta.env as Record<string, string | undefined>;
// reads through Anon-RPC; a signed write is broadcast directly (see anon.ts)
export const ark = arkivClients({ accessKey: env.ARKIV_ACCESS_KEY, transport: chainTransport() });
export const arkivWalletFor = (w: { account: any }) => ark.wallet(w.account);
export const hasAccessKey = Boolean(env.ARKIV_ACCESS_KEY);

export interface CheckedCredential { rec: CredentialRecord; ok: boolean; reason?: string }
export interface CheckedRevocation { rec: RevocationRecord; ok: boolean; reason?: string }
export interface CheckedListing { rec: ListingRecord; ok: boolean; reason?: string }
export interface ArkivSnapshot {
  credentials: CheckedCredential[];
  revocations: CheckedRevocation[];
  listings: CheckedListing[]; // the marketplace: filtered by the investor's choices
  ownListings: CheckedListing[]; // every listing by the demo sellers, unfiltered, so a seller always sees their own state
  superseded: Set<string>; // "attester:credId" (lower case) that Whitechain will refuse to register again
}

const attesterCache = new Map<string, boolean>();
const isAttester = async (a: Address) => {
  const k = a.toLowerCase();
  if (!attesterCache.has(k)) {
    attesterCache.set(k, (await publicClient.readContract({ address: attestersAddress, abi: attestersAbi, functionName: "isAttester", args: [a] })) as boolean);
  }
  return attesterCache.get(k)!;
};
const factoryNoteOf = async (nl: Hex) =>
  (await publicClient.readContract({ address: factoryAddress, abi: factoryAbi, functionName: "noteOf", args: [nl] })) as Address;
const noteSeller = async (n: Address) => (await publicClient.readContract({ address: n, abi: noteAbi, functionName: "seller" })) as Address;

/** `now` is the chain's clock. Listings stay visible a while after their due date so settled ones can be shown. */
export async function loadArkiv(now: number, filter: { minDiscountBps?: number; status?: string; dueWithinSeconds?: number; sort?: "due" | "discount" } = {}): Promise<ArkivSnapshot> {
  const attesterAddrs = wallets.filter((w) => w.role === "attester").map((w) => w.address);
  const sellerAddrs = wallets.filter((w) => w.role === "supplier").map((w) => w.address);
  const [creds, listings, revs, own] = await Promise.all([
    // only credentials for the labelled wallets this app can act as: anyone can write credential entities, and a flood
    // of them for strangers must not slow every read
    Promise.all(wallets.map((w) => findAllCredentials(ark.pub, { subject: w.address, notBefore: now }))).then((x) => x.flat()),
    findListings(ark.pub, { dueAfter: now - 6 * 3600, limit: 100, minDiscountBps: filter.minDiscountBps, status: filter.status || undefined, dueBefore: filter.dueWithinSeconds ? now + filter.dueWithinSeconds : undefined, sort: filter.sort }),
    Promise.all(attesterAddrs.map((a) => findRevocations(ark.pub, { attester: a }))).then((x) => x.flat()),
    Promise.all(sellerAddrs.map((a) => findListings(ark.pub, { dueAfter: now - 6 * 3600, seller: a, limit: 100 }))).then((x) => x.flat()),
  ]);
  const credentials = await Promise.all(creds.map(async (rec) => {
    const v = await verifyCredential(rec, { domain: attesterDomain, isAttester, now });
    return { rec, ok: v.ok, reason: v.ok ? undefined : v.reason };
  }));
  const revocations = await Promise.all(revs.map(async (rec) => {
    const v = await verifyRevocation(rec, { domain: attesterDomain });
    return { rec, ok: v.ok, reason: v.ok ? undefined : v.reason };
  }));
  const check = (list: typeof listings) => Promise.all(list.map(async (rec) => {
    const v = await verifyListing(rec, { factoryNoteOf, noteSeller }).catch(() => ({ ok: false as const, reason: "The chain could not confirm this listing." }));
    return { rec, ok: v.ok, reason: v.ok ? undefined : v.reason };
  }));
  // a credential that a newer one replaced can never be registered again; asking Whitechain keeps it off the Activate button
  const superseded = new Set<string>();
  await Promise.all(credentials.filter((c) => c.ok).map(async (c) => {
    const gone = (await publicClient.readContract({ address: attestersAddress, abi: attestersAbi, functionName: "superseded", args: [c.rec.attester, c.rec.credId] }).catch(() => false)) as boolean;
    if (gone) superseded.add(`${c.rec.attester.toLowerCase()}:${c.rec.credId.toLowerCase()}`);
  }));
  return { credentials, revocations, listings: await check(listings), ownListings: await check(own), superseded };
}

/** Starts listening for Arkiv changes; `onChange` is called at most once per second, so a burst of events costs one refresh. */
export function startWatching(onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // polled every 8 s: each poll is a round trip over Tor, so the SDK's half-block default would flood it
  return watchArkiv(ark.pub, () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, 1000);
  }, undefined, 8000);
}
