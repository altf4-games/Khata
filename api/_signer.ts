// Signs for the labelled demo wallets so their keys never reach a browser. Used by the Vercel function (api/sign.ts) and by the
// Vite dev server. The keys come from server-side environment variables (DEMO_<ID>_KEY), which are never exposed to client code.
//
// This is a public demo signer on testnets only, so it works from an allowlist: known chains, the project's own contracts and the
// notes its factory created, USDT approvals only to those, bounded gas, and typed data only in the exact shapes the app signs,
// with the subjects limited to the labelled demo wallets. It never signs a raw message. There is no login and no rate limit, so
// anyone who can reach it can still make a demo wallet perform an app action on the testnet; the wallets hold testnet tokens only.
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, parseAbi, toFunctionSelector, type Address, type Hex } from "viem";
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

// A note is a contract the Khata factory created: its nullifier maps back to its own address.
const known = new Set<string>();
const rpc = createPublicClient({ transport: http(deployment.rpc ?? "https://rpc.testnet.whitechain.io") });
export const liveDeps: SignDeps = {
  async isNote(address) {
    const a = lc(address);
    if (known.has(a)) return true;
    try {
      const n = (await rpc.readContract({ address: a as Address, abi: parseAbi(["function nullifier() view returns (bytes32)"]), functionName: "nullifier" })) as Hex;
      const back = (await rpc.readContract({ address: st.KhataFactory as Address, abi: parseAbi(["function noteOf(bytes32) view returns (address)"]), functionName: "noteOf", args: [n] })) as string;
      if (lc(back) === a) { known.add(a); return true; }
    } catch { /* not a note */ }
    return false;
  },
};

const nowSec = () => BigInt(Math.floor(Date.now() / 1000));
const big = (v: unknown): bigint => { if (typeof v === "bigint") return v; if (typeof v === "number" || typeof v === "string") return BigInt(v); throw new Error("number"); };

async function checkTransaction(tx: any, deps: SignDeps): Promise<SignResult | null> {
  const chain = Number(tx.chainId);
  if (chain !== WHITECHAIN && chain !== ARKIV_RABDI) return refuse(403, "Only Whitechain Sepolia and the Arkiv testnet are allowed.");
  if (!tx.to) return refuse(403, "Contract creation is not allowed.");
  if (tx.value && big(tx.value) !== 0n) return refuse(403, "Native funds cannot be sent from a demo wallet.");
  if (tx.authorizationList?.length) return refuse(403, "Authorizations are not allowed.");
  if (tx.gas !== undefined && big(tx.gas) > MAX_GAS) return refuse(403, "That gas limit is higher than the demo allows.");
  for (const f of [tx.maxFeePerGas, tx.gasPrice]) if (f !== undefined && big(f) > MAX_FEE_PER_GAS) return refuse(403, "That gas price is higher than the demo allows.");
  const to = lc(String(tx.to));
  const data = typeof tx.data === "string" ? lc(tx.data) : "0x";
  const selector = data.slice(0, 10);
  if (chain === ARKIV_RABDI) return ARKIV_WRITE_TARGETS.has(to) ? null : refuse(403, "Only Arkiv writes are allowed on the Arkiv testnet.");
  if (PROJECT.has(to)) return null;
  if (to === USDT) {
    if (selector !== APPROVE) return refuse(403, "Only approving a Khata note to spend USDT is allowed on the USDT token.");
    const spender = "0x" + data.slice(10 + 24, 10 + 64);
    if (data.length < 10 + 128 || !(PROJECT.has(spender) || (await deps.isNote(spender)))) return refuse(403, "USDT may only be approved to a Khata note.");
    return null;
  }
  if (await deps.isNote(to)) return NOTE_CALLS.has(selector as Hex) ? null : refuse(403, "That call is not part of the note's lifecycle.");
  return refuse(403, "That contract is not part of Khata.");
}

async function checkTypedData(wallet: string, ownAddress: string, td: any, deps: SignDeps): Promise<SignResult | null> {
  const d = td.domain as { chainId?: number | bigint; verifyingContract?: Address };
  if (Number(d?.chainId) !== WHITECHAIN || !d.verifyingContract) return refuse(403, "Only the USDT permit and the attester registry may be signed.");
  const domain = lc(d.verifyingContract);
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
      if (Number(m.tier) > MAX_TIER) return refuse(403, "That tier is higher than the demo allows.");
      if (big(m.validUntil) > ceiling) return refuse(403, "That credential lasts longer than the demo allows.");
      return null;
    }
    if (td.primaryType === "SellerBinding") {
      if (!DEMO_WALLETS.has(lc(String(m.wallet)))) return refuse(403, "A seller can only be bound to a labelled demo wallet here.");
      if (big(m.version) > MAX_VERSION) return refuse(403, "That binding version is higher than the demo allows.");
      if (big(m.validUntil) > ceiling) return refuse(403, "That binding lasts longer than the demo allows.");
      return null;
    }
    if (td.primaryType === "Revocation") return null;
    return refuse(403, "The attester does not sign that structure.");
  }
  return refuse(403, "Only the USDT permit and the attester registry may be signed.");
}

export async function handleSign(raw: unknown, env: Record<string, string | undefined>, deps: SignDeps = liveDeps): Promise<SignResult> {
  if (!raw || typeof raw !== "object") return refuse(400, "Send a JSON object.");
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
