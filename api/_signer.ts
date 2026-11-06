// Signs for the labelled demo wallets so their keys never reach a browser. Used by the Vercel function (api/sign.ts) and by the
// Vite dev server. The keys come from server-side environment variables (DEMO_<ID>_KEY), which are never exposed to client code.
//
// This is a public demo signer on testnets only, so it is deliberately narrow: only known chains, no native transfers, no direct
// USDT transfers, only the typed-data domains the app uses, and never an arbitrary message. It has no rate limit and no login:
// anyone who can reach it can make a demo wallet send a harmless testnet transaction. The wallets hold testnet tokens only.
import { privateKeyToAccount } from "viem/accounts";
import { toFunctionSelector, type Address, type Hex } from "viem";
import { wire } from "./_wire.ts";
import deployment from "../deployments/whitechain-sepolia.json" with { type: "json" };

const WHITECHAIN = 1874;
const ARKIV_RABDI = 7794095;
const CHAINS = new Set([WHITECHAIN, ARKIV_RABDI]);
const st = deployment.stage2;
const USDT = st.usdt.toLowerCase();
const BLOCKED_USDT = new Set([toFunctionSelector("transfer(address,uint256)"), toFunctionSelector("transferFrom(address,address,uint256)")]);
const TYPED_DOMAINS = new Set([USDT, st.AttesterRegistry.toLowerCase()]);
const IDS = new Set(["supplier", "investor", "investor2", "debtor", "attester"]);

export interface SignResult { status: number; body: { signed?: Hex; error?: string } }
const refuse = (status: number, error: string): SignResult => ({ status, body: { error } });

export async function handleSign(raw: unknown, env: Record<string, string | undefined>): Promise<SignResult> {
  if (!raw || typeof raw !== "object") return refuse(400, "Send a JSON object.");
  let req: any;
  try { req = wire.decode(raw); } catch { return refuse(400, "That request could not be read."); }
  const { wallet, kind } = req as { wallet?: unknown; kind?: unknown };
  if (typeof wallet !== "string" || !IDS.has(wallet)) return refuse(404, "That demo wallet does not exist.");
  if (kind !== "transaction" && kind !== "typedData") return refuse(400, "Only transactions and typed data can be signed here.");
  const key = env[`DEMO_${wallet.toUpperCase()}_KEY`];
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) return refuse(503, "This demo wallet is not configured on the server.");
  const account = privateKeyToAccount(key as Hex);

  if (kind === "transaction") {
    const tx = req.tx;
    if (!tx || typeof tx !== "object") return refuse(400, "A transaction is required.");
    if (!CHAINS.has(Number(tx.chainId))) return refuse(403, "Only Whitechain Sepolia and the Arkiv testnet are allowed.");
    if (!tx.to) return refuse(403, "Contract creation is not allowed.");
    if (tx.value && BigInt(tx.value) !== 0n) return refuse(403, "Native funds cannot be sent from a demo wallet.");
    if (tx.authorizationList?.length) return refuse(403, "Authorizations are not allowed.");
    if (String(tx.to).toLowerCase() === USDT && typeof tx.data === "string" && BLOCKED_USDT.has(tx.data.slice(0, 10).toLowerCase() as Hex))
      return refuse(403, "Direct USDT transfers are not allowed. Use the app's own actions.");
    return { status: 200, body: { signed: await account.signTransaction(tx) } };
  }

  const td = req.typedData;
  if (!td?.domain || !td.types || !td.primaryType) return refuse(400, "Typed data needs a domain, types and a primary type.");
  const d = td.domain as { chainId?: number | bigint; verifyingContract?: Address };
  if (Number(d.chainId) !== WHITECHAIN || !d.verifyingContract || !TYPED_DOMAINS.has(d.verifyingContract.toLowerCase()))
    return refuse(403, "Only the USDT permit and the attester registry may be signed.");
  return { status: 200, body: { signed: await account.signTypedData(td) } };
}
