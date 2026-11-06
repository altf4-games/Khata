// Khata's Arkiv layer. Arkiv is where credentials, revocations and note listings are published and found;
// Whitechain stays the place where they are enforced. Nothing read from Arkiv is trusted on its own:
// every credential's signature is recovered and compared with the entity's owner, and every listing is
// checked against the factory that made the note.
import { createPublicClient, createWalletClient, ExpirationTime } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { and, asc, desc, eq, gt, gte, lte } from "@arkiv-network/sdk/query";
import { addr, bytes, defineSchema, key as keyValue, str, u64 } from "@arkiv-network/sdk/schema";
import { bytesToHex, hexToBytes, http, recoverTypedDataAddress, type Account, type Address, type Hex, type Transport } from "viem";
import { ELIGIBILITY_TYPES, REVOCATION_TYPES } from "./eip712";

// ---------- schemas ----------
export const Credential = defineSchema("khata.credential", {
  subject: addr().indexed(),
  attester: addr().indexed(),
  tier: u64().indexed(),
  validUntil: u64().indexed(), // unix seconds, the same value the attester signed
  credId: str().indexed(), // 0x + 64 hex, the id the attester signed
  jurisdiction: u64(),
  signature: bytes(), // the attester's EIP-712 signature, 65 bytes
});

export const Revocation = defineSchema("khata.revocation", {
  attester: addr().indexed(),
  credId: str().indexed(),
  signature: bytes(),
});

export const Listing = defineSchema("khata.listing", {
  note: addr().indexed(),
  seller: addr().indexed(),
  nullifier: str().indexed(),
  faceValue: u64().indexed(), // micro-USDT
  discountBps: u64().indexed(),
  dueDate: u64().indexed(), // unix seconds
  minTier: u64().indexed(),
  status: str().indexed(), // open | closed | settled | defaulted
  title: str(),
});

// ---------- clients ----------
export interface ArkivConfig {
  accessKey?: string;
  transport: Transport; // required: a browser caller must choose it (Anon-RPC for reads), so no default can bypass it
}
export function arkivClients(cfg: ArkivConfig) {
  const chain = rabdi({ accessKey: cfg.accessKey ?? "" });
  const transport = cfg.transport;
  return {
    chain,
    pub: createPublicClient({ chain, transport }),
    wallet: (account: Account) => createWalletClient({ chain, transport, account }),
  };
}
export type ArkivPublic = ReturnType<typeof arkivClients>["pub"];
export type ArkivWallet = ReturnType<ReturnType<typeof arkivClients>["wallet"]>;

/** A readable reason when Arkiv cannot be reached or refuses, instead of a raw RPC dump. */
export class ArkivUnavailable extends Error {
  constructor(public readonly why: string, cause?: unknown) {
    super(why, { cause });
  }
}
export function arkivError(e: unknown): ArkivUnavailable {
  // The SDK's top-level message can hide the cause ("Execution error without revert data" for an unfunded wallet),
  // so every message in the cause chain is searched.
  const parts: string[] = [];
  for (let x: any = e, n = 0; x && n < 8; x = x.cause, n++) parts.push(String(x.shortMessage ?? x.message ?? x) + (x.status ? ` (HTTP ${x.status})` : "") + (x.details ? ` ${x.details}` : ""));
  const msg = parts.join(" | ");
  if (/429|rate.?limit|too many/i.test(msg)) return new ArkivUnavailable("Arkiv is rate limiting this connection. Wait a few seconds and try again; a free access key lifts the limit.", e);
  if (/timeout|timed out|504|502|503|fetch failed|network/i.test(msg)) return new ArkivUnavailable("Arkiv did not answer in time. Whitechain still works; credentials already registered there are unaffected.", e);
  if (/insufficient funds|exceeds the balance/i.test(msg)) return new ArkivUnavailable("This wallet has no Arkiv testnet tokens (tGLM) for the fee.", e);
  return new ArkivUnavailable(`Arkiv refused the request: ${parts[0].split("\n")[0]}`, e);
}
async function guard<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof ArkivUnavailable) throw e;
    throw arkivError(e);
  }
}

// where() is typed against the schema; predicates are assembled dynamically here, so one cast lives in this helper
const pred = (preds: any[]): any => (preds.length === 1 ? preds[0] : (and as any)(...preds));

const num = (x: any) => Number(x?.value ?? x);
const text = (x: any) => String(x?.value ?? x);
// bytes columns come back as 0x-prefixed hex strings (the SDK README decodes them with hexToString)
const hexOf = (x: any): Hex => {
  const v = x?.value ?? x;
  return (typeof v === "string" ? v : bytesToHex(v)) as Hex;
};

// ---------- credentials ----------
export interface CredentialRecord {
  entityKey: Hex;
  owner: Address;
  subject: Address;
  attester: Address;
  tier: number;
  validUntil: number;
  credId: Hex;
  jurisdiction: number;
  signature: Hex;
}

export async function publishCredential(w: ArkivWallet, c: Omit<CredentialRecord, "entityKey" | "owner">) {
  return guard(() =>
    w.createEntity(
      Credential,
      {
        subject: addr(c.subject), attester: addr(c.attester), tier: u64(c.tier), validUntil: u64(c.validUntil),
        credId: c.credId, jurisdiction: u64(c.jurisdiction), signature: hexToBytes(c.signature),
      },
      // The entity lives until the credential's own expiry (rounded to blocks). The chain, not Arkiv, decides eligibility.
      { expiration: ExpirationTime.atDate(new Date(c.validUntil * 1000), { atLeast: ExpirationTime.fromSeconds(10) }) },
    ),
  );
}

const credRow = (r: any): CredentialRecord => ({
  entityKey: r.$key, owner: r.$owner, subject: r.subject?.value, attester: r.attester?.value, tier: num(r.tier),
  validUntil: num(r.validUntil), credId: text(r.credId) as Hex, jurisdiction: num(r.jurisdiction), signature: hexOf(r.signature),
});

/** Credentials for one wallet that have not expired yet, newest expiry last. */
export async function findCredentials(pub: ArkivPublic, opts: { subject?: Address; attester?: Address; notBefore: number; limit?: number }): Promise<CredentialRecord[]> {
  return guard(async () => {
    const preds = [gt("validUntil", u64(opts.notBefore))] as any[];
    if (opts.subject) preds.push(eq("subject", addr(opts.subject)));
    if (opts.attester) preds.push(eq("attester", addr(opts.attester)));
    const q = (pub.select({ $key: true, $owner: true, subject: true, attester: true, tier: true, validUntil: true, credId: true, jurisdiction: true, signature: true })
      .from(Credential) as any).where(pred(preds)).orderBy(asc("validUntil")).limit(opts.limit ?? 50);
    const res = await q.fetch();
    return res.entities.map(credRow);
  });
}

export type Verdict = { ok: true } | { ok: false; reason: string };

/** A credential from Arkiv counts only if the signature recovers to its stated attester, who also owns the entity. */
export async function verifyCredential(
  c: CredentialRecord,
  ctx: { domain: any; isAttester: (a: Address) => Promise<boolean>; now: number },
): Promise<Verdict> {
  let signer: Address;
  try {
    signer = await recoverTypedDataAddress({
      domain: ctx.domain, types: ELIGIBILITY_TYPES, primaryType: "Eligibility",
      message: { subject: c.subject, tier: c.tier, jurisdiction: c.jurisdiction, validUntil: BigInt(c.validUntil), credId: c.credId },
      signature: c.signature,
    });
  } catch {
    return { ok: false, reason: "The signature is malformed." };
  }
  if (signer.toLowerCase() !== c.attester.toLowerCase()) return { ok: false, reason: "The signature was not made by the attester named in the entity." };
  if (c.owner.toLowerCase() !== c.attester.toLowerCase()) return { ok: false, reason: "The entity was written by someone other than the attester." };
  if (c.validUntil <= ctx.now) return { ok: false, reason: "The credential has expired." };
  if (!(await ctx.isAttester(signer))) return { ok: false, reason: "The signer is not an attester Whitechain accepts." };
  return { ok: true };
}

// ---------- revocations ----------
export interface RevocationRecord { entityKey: Hex; owner: Address; attester: Address; credId: Hex; signature: Hex }

export async function publishRevocation(w: ArkivWallet, r: { attester: Address; credId: Hex; signature: Hex }, keepUntil: number) {
  return guard(() =>
    w.createEntity(Revocation, { attester: addr(r.attester), credId: r.credId, signature: hexToBytes(r.signature) },
      { expiration: ExpirationTime.atDate(new Date(keepUntil * 1000), { atLeast: ExpirationTime.fromMinutes(10) }) }),
  );
}
export async function findRevocations(pub: ArkivPublic, opts: { attester: Address; credId?: Hex }): Promise<RevocationRecord[]> {
  return guard(async () => {
    const preds = [eq("attester", addr(opts.attester))] as any[];
    if (opts.credId) preds.push(eq("credId", opts.credId));
    const res = await (pub.select({ $key: true, $owner: true, attester: true, credId: true, signature: true })
      .from(Revocation) as any).where(pred(preds)).limit(50).fetch();
    return res.entities.map((r: any): RevocationRecord => ({ entityKey: r.$key, owner: r.$owner, attester: r.attester.value, credId: text(r.credId) as Hex, signature: hexOf(r.signature) }));
  });
}
export async function verifyRevocation(r: RevocationRecord, ctx: { domain: any }): Promise<Verdict> {
  try {
    const signer = await recoverTypedDataAddress({ domain: ctx.domain, types: REVOCATION_TYPES, primaryType: "Revocation", message: { credId: r.credId }, signature: r.signature });
    if (signer.toLowerCase() !== r.attester.toLowerCase() || r.owner.toLowerCase() !== r.attester.toLowerCase()) return { ok: false, reason: "The revocation is not signed and published by its attester." };
    return { ok: true };
  } catch {
    return { ok: false, reason: "The signature is malformed." };
  }
}

// ---------- listings ----------
export interface ListingRecord {
  entityKey: Hex; owner: Address; note: Address; seller: Address; nullifier: Hex; faceValue: bigint;
  discountBps: number; dueDate: number; minTier: number; status: string; title: string;
}
export async function publishListing(w: ArkivWallet, l: Omit<ListingRecord, "entityKey" | "owner">, graceSeconds: number) {
  return guard(() =>
    w.createEntity(Listing, {
      note: addr(l.note), seller: addr(l.seller), nullifier: l.nullifier, faceValue: u64(l.faceValue), discountBps: u64(l.discountBps),
      dueDate: u64(l.dueDate), minTier: u64(l.minTier), status: l.status, title: l.title,
    }, { expiration: ExpirationTime.atDate(new Date((l.dueDate + graceSeconds + 3600) * 1000), { atLeast: ExpirationTime.fromMinutes(10) }) }),
  );
}
export async function setListingStatus(w: ArkivWallet, entityKey: Hex, status: string) {
  return guard(() => w.patchEntity(Listing, entityKey, { set: { status } }));
}
const listingRow = (r: any): ListingRecord => ({
  entityKey: r.$key, owner: r.$owner, note: r.note?.value, seller: r.seller?.value, nullifier: text(r.nullifier) as Hex,
  faceValue: BigInt(r.faceValue?.value ?? 0), discountBps: num(r.discountBps), dueDate: num(r.dueDate), minTier: num(r.minTier),
  status: text(r.status), title: text(r.title),
});
export async function findListings(pub: ArkivPublic, opts: { status?: string; dueAfter: number; seller?: Address; minDiscountBps?: number; dueBefore?: number; sort?: "due" | "discount"; limit?: number }): Promise<ListingRecord[]> {
  return guard(async () => {
    const preds = [gte("dueDate", u64(opts.dueAfter))] as any[];
    if (opts.status) preds.push(eq("status", opts.status));
    if (opts.seller) preds.push(eq("seller", addr(opts.seller)));
    if (opts.minDiscountBps) preds.push(gte("discountBps", u64(opts.minDiscountBps)));
    if (opts.dueBefore) preds.push(lte("dueDate", u64(opts.dueBefore)));
    const res = await (pub.select({ $key: true, $owner: true, note: true, seller: true, nullifier: true, faceValue: true, discountBps: true, dueDate: true, minTier: true, status: true, title: true })
      .from(Listing) as any).where(pred(preds)).orderBy(opts.sort === "discount" ? desc("discountBps") : asc("dueDate")).limit(opts.limit ?? 50).fetch();
    return res.entities.map(listingRow);
  });
}
/** A listing counts only if its owner is the seller and the factory really made that note for that invoice and seller. */
export async function verifyListing(l: ListingRecord, ctx: { factoryNoteOf: (nullifier: Hex) => Promise<Address>; noteSeller: (note: Address) => Promise<Address> }): Promise<Verdict> {
  if (l.owner.toLowerCase() !== l.seller.toLowerCase()) return { ok: false, reason: "The listing was published by someone other than the seller." };
  const made = await ctx.factoryNoteOf(l.nullifier);
  if (made.toLowerCase() !== l.note.toLowerCase()) return { ok: false, reason: "The note is not the one Khata created for this invoice." };
  if ((await ctx.noteSeller(l.note)).toLowerCase() !== l.seller.toLowerCase()) return { ok: false, reason: "The listed seller is not the note's seller." };
  return { ok: true };
}

// ---------- paging by key, live events, extension ----------
const SELECT_CREDENTIAL = { $key: true, $owner: true, subject: true, attester: true, tier: true, validUntil: true, credId: true, jurisdiction: true, signature: true } as const;

/**
 * Every unexpired credential matching the filters, read exactly once even while others write: sorted by
 * `$key`, each page continues after the last key of the previous one (offsets would repeat or skip rows
 * when entities are created or deleted between requests).
 *
 * Anyone can write an entity that matches the query but does not fit the schema; such rows are skipped by the
 * SDK. If a whole page is skipped there is no row to continue from, so the cursor is read from a keys-only query.
 */
export async function findAllCredentials(
  pub: ArkivPublic,
  opts: { subject?: Address; attester?: Address; notBefore: number; pageSize?: number; onPage?: (rows: CredentialRecord[]) => void | Promise<void> },
): Promise<CredentialRecord[]> {
  return guard(async () => {
    const pageSize = Math.min(opts.pageSize ?? 100, 100);
    const out: CredentialRecord[] = [];
    let cursor: Hex | undefined;
    for (;;) {
      const preds = [gt("validUntil", u64(opts.notBefore))] as any[];
      if (opts.subject) preds.push(eq("subject", addr(opts.subject)));
      if (opts.attester) preds.push(eq("attester", addr(opts.attester)));
      if (cursor) preds.push(gt("$key", keyValue(cursor)));
      const res = await (pub.select(SELECT_CREDENTIAL).from(Credential) as any).where(pred(preds)).orderBy(asc("$key")).limit(pageSize).fetch();
      const rows: CredentialRecord[] = res.entities.map(credRow);
      out.push(...rows);
      await opts.onPage?.(rows);
      let last = rows.length ? rows[rows.length - 1].entityKey : undefined;
      if (res.skipped > 0) {
        const keys = await (pub.select({ $key: true }) as any).where(pred(preds)).orderBy(asc("$key")).limit(pageSize).fetch();
        const k = keys.entities.map((e: any) => e.$key as Hex);
        if (k.length) last = k[k.length - 1];
      }
      if (!last || (rows.length + res.skipped < pageSize)) break;
      cursor = last;
    }
    return out;
  });
}

/** Calls `onChange` with the event type whenever any entity is created, changed, extended or deleted. Returns a stop function. */
export function watchArkiv(pub: ArkivPublic, onChange: (type: string) => void, onError?: (e: Error) => void, pollingInterval?: number): () => void {
  return (pub as any).watchEntityEvents({ onEvent: (e: { type: string }) => onChange(e.type), onError: (e: Error) => onError?.(arkivError(e)), pollingInterval });
}

/** Moves a listing's expiry out to `seconds` from now. Only the listing's owner can do this. */
export async function extendListing(w: ArkivWallet, entityKey: Hex, seconds: number) {
  return guard(() => w.extendEntity({ entityKey, expiration: ExpirationTime.fromSeconds(seconds) }));
}


/**
 * The credential to offer an investor for activation: the longest-lived one that verified and that no verified
 * revocation names. Registering a revoked credential on Whitechain would only revert.
 */
export function pickActivatable<C extends { rec: CredentialRecord; ok: boolean }>(
  credentials: C[],
  revocations: { rec: RevocationRecord; ok: boolean }[],
): C | undefined {
  const revoked = new Set(revocations.filter((r) => r.ok).map((r) => r.rec.credId.toLowerCase()));
  return credentials
    .filter((c) => c.ok && !revoked.has(c.rec.credId.toLowerCase()))
    .sort((a, b) => b.rec.validUntil - a.rec.validUntil)[0];
}
