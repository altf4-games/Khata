// Signs for the labelled demo wallets so their keys never reach a browser. Used by the Vercel function (api/sign.ts) and by the
// Vite dev server. The keys come from server-side environment variables (DEMO_<ID>_KEY), which are never exposed to client code.
//
// This is a public demo signer on testnets only, so it works from an allowlist: known chains, the project's own contracts and the
// notes its factory created, USDT approvals only to those, bounded gas, and typed data only in the exact shapes the app signs,
// with the subjects limited to the labelled demo wallets. It never signs a raw message. There is no login and no rate limit, so
// anyone who can reach it can still make a demo wallet perform an app action on the testnet; the wallets hold testnet tokens only.
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, parseAbi, toFunctionSelector, type Abi, type AbiFunction, type Address, type Hex } from "viem";
import registryAbi from "../web/src/registry-abi.json" with { type: "json" };
import factoryAbi from "../web/src/factory-abi.json" with { type: "json" };
import attestersAbi from "../web/src/attesters-abi.json" with { type: "json" };
import { wire } from "./_wire.ts";
import deployment from "../deployments/whitechain-sepolia.json" with { type: "json" };
import demoWallets from "../deployments/demo-wallets.json" with { type: "json" };

const WHITECHAIN = 1874;
const ARKIV_RABDI = 7794095;
// Where the Arkiv SDK sends writes on Rabdi (ARKIV_ADDRESS in the SDK), and the earlier testnet's address.
const ARKIV_WRITE_TARGETS = new Set(["0x4400000000000000000000000000000000000044", "0x00000000000000000000000000000061726b6976"]);
const st = deployment.stage2;
const lc = (a: string) => a.toLowerCase();
const USDT = lc(st.usdt);
const PROJECT = new Set([lc(st.KhataRegistry), lc(st.KhataFactory), lc(st.AttesterRegistry)]);
// Only the functions the app calls on each project contract. Owner functions (addKey, setZkVerifier, ownership, attester admin) are never signed here.
const fns = (abi: unknown, names: string[]) => new Set(names.map((n) => toFunctionSelector((abi as Abi).find((i) => i.type === "function" && i.name === n) as AbiFunction)));
const PROJECT_CALLS = new Map<string, Set<string>>([
  [lc(st.KhataRegistry), fns(registryAbi, ["bindInvoice", "bindInvoiceZk", "registerSeller"])],
  [lc(st.KhataFactory), fns(factoryAbi, ["createNote"])],
  [lc(st.AttesterRegistry), fns(attestersAbi, ["register", "revoke"])],
]);
const DEMO_WALLETS = new Set(demoWallets.map((w) => lc(w.address)));
const IDS = new Set(demoWallets.map((w) => w.id));
const sel = (sig: string) => toFunctionSelector(sig);
const APPROVE = sel("approve(address,uint256)");
// What the app asks of a note. Share transfers go through the note's own transfer rules; approving a stranger is not part of it.
const NOTE_CALLS = new Set(["fund(uint256)", "fundWithPermit(uint256,uint256,uint8,bytes32,bytes32)", "closeFunding()", "settle()", "redeem()", "markDefault()", "transfer(address,uint256)"].map(sel));

const MAX_GAS = 8_000_000n;
const MAX_FEE_PER_GAS = 50_000_000_000n; // 50 gwei; the chain runs at about 5
const MAX_PERMIT_VALUE = 10_000n * 1_000_000n; // 10,000 USDT (6 decimals)
const MAX_TIER = 3;
const MAX_VALID_SECONDS = 30 * 24 * 3600;
const MAX_PERMIT_SECONDS = 3600;
const MAX_VERSION = 1_000_000n;

export interface SignDeps { isNote(address: string): Promise<boolean> }
export interface SignResult { status: number; body: { signed?: Hex; error?: string } }
const refuse = (status: number, error: string): SignResult => ({ status, body: { error } });

// A note is a contract the Khata factory created: its nullifier maps back to its own address. Answers are cached, including "no"
// (for a while), so a flood of made-up addresses costs one lookup each; anything that is not an address is never looked up.
const rpc = createPublicClient({ transport: http(deployment.rpc ?? "https://rpc.testnet.whitechain.io") });
const noteAbi = parseAbi(["function nullifier() view returns (bytes32)"]);
const factoryRead = parseAbi(["function noteOf(bytes32) view returns (address)"]);
const NEGATIVE_TTL_MS = 60_000;
const MAX_CACHE = 5000;
export type NoteReader = (address: string) => Promise<boolean>;
export function makeLiveDeps(read: NoteReader, now: () => number = Date.now): SignDeps {
  const yes = new Set<string>();
  const no = new Map<string, number>();
  return {
    async isNote(address) {
      if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) return false;
      const a = lc(address);
      if (yes.has(a)) return true;
      const until = no.get(a);
      if (until !== undefined && until > now()) return false;
      let ok = false;
      try { ok = await read(a); } catch { ok = false; }
      if (ok) yes.add(a);
      else { if (no.size >= MAX_CACHE) no.clear(); no.set(a, now() + NEGATIVE_TTL_MS); }
      return ok;
    },
  };
}
const readNoteOnChain: NoteReader = async (a) => {
  const n = (await rpc.readContract({ address: a as Address, abi: noteAbi, functionName: "nullifier" })) as Hex;
  const back = (await rpc.readContract({ address: st.KhataFactory as Address, abi: factoryRead, functionName: "noteOf", args: [n] })) as string;
  return lc(back) === a;
};
export const liveDeps: SignDeps = makeLiveDeps(readNoteOnChain);

/** A best-effort limiter kept in one function instance's memory: it slows a flood from one caller and caps the total, no more. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private o: { perCaller: number; total: number; windowMs: number }) {}
  allow(caller: string, now = Date.now()): boolean {
    const from = now - this.o.windowMs;
    let all = 0;
    for (const [k, v] of this.hits) { const keep = v.filter((t) => t > from); if (keep.length) { this.hits.set(k, keep); all += keep.length; } else this.hits.delete(k); }
    const mine = this.hits.get(caller) ?? [];
    if (mine.length >= this.o.perCaller || all >= this.o.total) return false;
    mine.push(now);
    this.hits.set(caller, mine);
    return true;
  }
}

const nowSec = () => BigInt(Math.floor(Date.now() / 1000));
// Non-negative whole numbers only: bigint, a safe integer, or a decimal string. No hex, no fractions, no negatives, no NaN.
const big = (v: unknown): bigint => {
  if (typeof v === "bigint" && v >= 0n) return v;
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  if (typeof v === "string" && /^[0-9]{1,78}$/.test(v)) return BigInt(v);
  throw new Error("number");
};

async function checkTransaction(tx: any, deps: SignDeps): Promise<SignResult | null> {
  if (typeof tx.chainId !== "number" && typeof tx.chainId !== "bigint") return refuse(400, "A numeric chain id is required.");
  const chain = Number(tx.chainId);
  if (chain !== WHITECHAIN && chain !== ARKIV_RABDI) return refuse(403, "Only Whitechain Sepolia and the Arkiv testnet are allowed.");
  if (!tx.to) return refuse(403, "Contract creation is not allowed.");
  if (tx.value !== undefined && big(tx.value) !== 0n) return refuse(403, "Native funds cannot be sent from a demo wallet.");
  if (tx.authorizationList?.length) return refuse(403, "Authorizations are not allowed.");
  if (tx.gas !== undefined && big(tx.gas) > MAX_GAS) return refuse(403, "That gas limit is higher than the demo allows.");
  for (const f of [tx.maxFeePerGas, tx.gasPrice]) if (f !== undefined && big(f) > MAX_FEE_PER_GAS) return refuse(403, "That gas price is higher than the demo allows.");
  const to = lc(String(tx.to));
  const data = typeof tx.data === "string" ? lc(tx.data) : "0x";
  const selector = data.slice(0, 10);
  if (chain === ARKIV_RABDI) return ARKIV_WRITE_TARGETS.has(to) ? null : refuse(403, "Only Arkiv writes are allowed on the Arkiv testnet.");
  if (PROJECT.has(to)) return PROJECT_CALLS.get(to)!.has(selector as Hex) ? null : refuse(403, "That call is not one the Khata app makes.");
  if (to === USDT) {
    if (selector !== APPROVE) return refuse(403, "Only approving a Khata note to spend USDT is allowed on the USDT token.");
    const spender = "0x" + data.slice(10 + 24, 10 + 64);
    if (data.length < 10 + 128 || !(PROJECT.has(spender) || (await deps.isNote(spender)))) return refuse(403, "USDT may only be approved to a Khata note.");
    return null;
  }
  if (await deps.isNote(to)) return NOTE_CALLS.has(selector as Hex) ? null : refuse(403, "That call is not part of the note's lifecycle.");
  return refuse(403, "That contract is not part of Khata.");
}

const T = (...f: [string, string][]) => f.map(([name, type]) => ({ name, type }));
const SHAPES: Record<string, { fields: { name: string; type: string }[] }> = {
  Permit: { fields: T(["owner", "address"], ["spender", "address"], ["value", "uint256"], ["nonce", "uint256"], ["deadline", "uint256"]) },
  Eligibility: { fields: T(["subject", "address"], ["tier", "uint8"], ["jurisdiction", "uint16"], ["validUntil", "uint64"], ["credId", "bytes32"]) },
  Revocation: { fields: T(["credId", "bytes32"]) },
  SellerBinding: { fields: T(["gstinHash", "bytes32"], ["wallet", "address"], ["validUntil", "uint64"], ["version", "uint64"]) },
};
/** The declared types must be exactly the one struct, with exactly its fields in order, and the message must carry exactly those keys. */
function exactShape(td: any): boolean {
  const shape = SHAPES[td.primaryType];
  if (!shape || !td.types || typeof td.types !== "object") return false;
  const names = Object.keys(td.types).filter((k) => k !== "EIP712Domain");
  if (names.length !== 1 || names[0] !== td.primaryType) return false;
  const got = td.types[td.primaryType];
  if (!Array.isArray(got) || got.length !== shape.fields.length) return false;
  if (!got.every((f: any, i: number) => f?.name === shape.fields[i].name && f?.type === shape.fields[i].type)) return false;
  const m = td.message;
  if (!m || typeof m !== "object") return false;
  const keys = Object.keys(m);
  return keys.length === shape.fields.length && shape.fields.every((f) => keys.includes(f.name));
}

async function checkTypedData(wallet: string, ownAddress: string, td: any, deps: SignDeps): Promise<SignResult | null> {
  const d = td.domain as { chainId?: number | bigint; verifyingContract?: Address };
  if (Number(d?.chainId) !== WHITECHAIN || !d.verifyingContract) return refuse(403, "Only the USDT permit and the attester registry may be signed.");
  const domain = lc(d.verifyingContract);
  if (!exactShape(td)) return refuse(403, "That is not a structure the app signs, in the exact form the contract hashes.");
  const m = td.message ?? {};
  if (domain === USDT) {
    if (td.primaryType !== "Permit") return refuse(403, "Only a USDT permit may be signed on the USDT domain.");
    if (lc(String(m.owner)) !== lc(ownAddress)) return refuse(403, "A permit can only be signed by the wallet that owns the tokens.");
    if (!(await deps.isNote(String(m.spender)))) return refuse(403, "A permit can only be granted to a Khata note.");
    if (big(m.value) > MAX_PERMIT_VALUE) return refuse(403, "That permit is larger than the demo allows.");
    if (big(m.deadline) > nowSec() + BigInt(MAX_PERMIT_SECONDS)) return refuse(403, "That permit lasts longer than the demo allows.");
    return null;
  }
  if (domain === lc(st.AttesterRegistry)) {
    if (wallet !== "attester") return refuse(403, "Only the attester wallet signs for the attester registry.");
    const ceiling = nowSec() + BigInt(MAX_VALID_SECONDS);
    if (td.primaryType === "Eligibility") {
      if (!DEMO_WALLETS.has(lc(String(m.subject)))) return refuse(403, "Credentials can only be issued to the labelled demo wallets here.");
      if (big(m.tier) > BigInt(MAX_TIER)) return refuse(403, "That tier is higher than the demo allows.");
      if (big(m.validUntil) > ceiling) return refuse(403, "That credential lasts longer than the demo allows.");
      return null;
    }
    if (td.primaryType === "SellerBinding") {
      if (!DEMO_WALLETS.has(lc(String(m.wallet)))) return refuse(403, "A seller can only be bound to a labelled demo wallet here.");
      if (big(m.version) > MAX_VERSION) return refuse(403, "That binding version is higher than the demo allows.");
      if (big(m.validUntil) > ceiling) return refuse(403, "That binding lasts longer than the demo allows.");
      return null;
    }
    // A revocation names a credential by its id only; it is rate limited like everything else, and the id must be 32 bytes.
    if (td.primaryType === "Revocation") return /^0x[0-9a-fA-F]{64}$/.test(String(m.credId)) ? null : refuse(403, "A revocation needs a 32-byte credential id.");
    return refuse(403, "The attester does not sign that structure.");
  }
  return refuse(403, "Only the USDT permit and the attester registry may be signed.");
}

export const MAX_BODY_BYTES = 64 * 1024;

export async function handleSign(raw: unknown, env: Record<string, string | undefined>, deps: SignDeps = liveDeps): Promise<SignResult> {
  if (!raw || typeof raw !== "object") return refuse(400, "Send a JSON object.");
  let size = 0;
  try { size = JSON.stringify(raw, (_k, v) => (typeof v === "bigint" ? v.toString() : v)).length; } catch { return refuse(400, "That request could not be read."); }
  if (size > MAX_BODY_BYTES) return refuse(413, "That request is larger than the demo accepts.");
  let req: any;
  try { req = wire.decode(raw); } catch { return refuse(400, "That request could not be read."); }
  const { wallet, kind } = req as { wallet?: unknown; kind?: unknown };
  if (typeof wallet !== "string" || !IDS.has(wallet)) return refuse(404, "That demo wallet does not exist.");
  if (kind !== "transaction" && kind !== "typedData") return refuse(400, "Only transactions and typed data can be signed here.");
  const key = env[`DEMO_${wallet.toUpperCase()}_KEY`];
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) return refuse(503, "This demo wallet is not configured on the server.");
  const account = privateKeyToAccount(key as Hex);
  try {
    if (kind === "transaction") {
      const tx = req.tx;
      if (!tx || typeof tx !== "object") return refuse(400, "A transaction is required.");
      return (await checkTransaction(tx, deps)) ?? { status: 200, body: { signed: await account.signTransaction(tx) } };
    }
    const td = req.typedData;
    if (!td?.domain || !td.types || !td.primaryType) return refuse(400, "Typed data needs a domain, types and a primary type.");
    return (await checkTypedData(wallet, account.address, td, deps)) ?? { status: 200, body: { signed: await account.signTypedData(td) } };
  } catch {
    return refuse(400, "That request contained a value that could not be read.");
  }
}
