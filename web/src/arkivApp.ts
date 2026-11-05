// Arkiv as the app uses it: shared clients, and one loader that reads credentials, revocations and listings
// and checks each one before the views see it.
import type { Address, Hex } from "viem";
import { attesterDomain, attestersAbi, attestersAddress, factoryAbi, factoryAddress, noteAbi, publicClient } from "./chain";
import {
  arkivClients, findCredentials, findListings, findRevocations, verifyCredential, verifyListing, verifyRevocation,
  type CredentialRecord, type ListingRecord, type RevocationRecord,
} from "./arkiv";
import { wallets } from "./wallets";

const env = import.meta.env as Record<string, string | undefined>;
export const ark = arkivClients({ accessKey: env.ARKIV_ACCESS_KEY });
export const arkivWalletFor = (w: { account: any }) => ark.wallet(w.account);
export const hasAccessKey = Boolean(env.ARKIV_ACCESS_KEY);

export interface CheckedCredential { rec: CredentialRecord; ok: boolean; reason?: string }
export interface CheckedRevocation { rec: RevocationRecord; ok: boolean; reason?: string }
export interface CheckedListing { rec: ListingRecord; ok: boolean; reason?: string }
export interface ArkivSnapshot {
  credentials: CheckedCredential[];
  revocations: CheckedRevocation[];
  listings: CheckedListing[];
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
export async function loadArkiv(now: number, filter: { minDiscountBps?: number; status?: string } = {}): Promise<ArkivSnapshot> {
  const attesterAddrs = wallets.filter((w) => w.role === "attester").map((w) => w.address);
  const [creds, listings, revs] = await Promise.all([
    findCredentials(ark.pub, { notBefore: now, limit: 100 }),
    findListings(ark.pub, { dueAfter: now - 6 * 3600, limit: 100, minDiscountBps: filter.minDiscountBps, status: filter.status || undefined }),
    Promise.all(attesterAddrs.map((a) => findRevocations(ark.pub, { attester: a }))).then((x) => x.flat()),
  ]);
  const credentials = await Promise.all(creds.map(async (rec) => {
    const v = await verifyCredential(rec, { domain: attesterDomain, isAttester, now });
    return { rec, ok: v.ok, reason: v.ok ? undefined : v.reason };
  }));
  const revocations = await Promise.all(revs.map(async (rec) => {
    const v = await verifyRevocation(rec, { domain: attesterDomain });
    return { rec, ok: v.ok, reason: v.ok ? undefined : v.reason };
  }));
  const checkedListings = await Promise.all(listings.map(async (rec) => {
    const v = await verifyListing(rec, { factoryNoteOf, noteSeller }).catch(() => ({ ok: false as const, reason: "The chain could not confirm this listing." }));
    return { rec, ok: v.ok, reason: v.ok ? undefined : v.reason };
  }));
  return { credentials, revocations, listings: checkedListings };
}
