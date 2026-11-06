// Reads notes and credentials from the chain. Everything shown comes from contract state, nothing is cached as truth.
import type { Address } from "viem";
import { buildTimeline, type RawEvent, type Step } from "./timeline";
import { nameOf } from "./wallets";
import {
  abi, attestersAbi, attestersAddress, registryAddress, factoryAbi, factoryAddress, factoryDeployTx, noteAbi, publicClient, usdtAbi, usdtAddress,
} from "./chain";

export const PHASES = ["Funding", "Settled", "Defaulted"] as const;
export type PhaseName = (typeof PHASES)[number];
export const REASONS = ["Eligible", "NoCredential", "Expired", "Revoked", "AttesterRemoved"] as const;

export interface NoteInfo {
  address: Address;
  name: string;
  seller: Address;
  faceValue: bigint;
  fundableAt: number;
  fundingDeadline: number;
  dueDate: number;
  graceSeconds: number;
  discountBps: number;
  minTier: number;
  phase: PhaseName;
  fundingClosed: boolean;
  fundedFace: bigint;
  available: bigint; // notes still in escrow, for sale
  totalSupply: bigint;
  nullifier: `0x${string}`;
}

let fromBlock: bigint | undefined;
export async function startBlock() {
  if (fromBlock === undefined) fromBlock = (await publicClient.getTransactionReceipt({ hash: factoryDeployTx })).blockNumber;
  return fromBlock;
}

export async function nowChain(): Promise<number> {
  return Number((await publicClient.getBlock()).timestamp);
}

// Whitechain's RPC refuses eth_getLogs over more than 10,000 blocks ("query exceeds max block range 10000"),
// so events are read in chunks from the deployment block, and later calls only scan the blocks since the last one.
const CHUNK = 9_000n;
const logCache = new Map<string, { next: bigint; logs: any[] }>();
export async function eventsSince(address: Address, abi: any, eventName: string): Promise<any[]> {
  const key = `${address}:${eventName}`;
  const c = logCache.get(key) ?? { next: await startBlock(), logs: [] };
  const head = await publicClient.getBlockNumber();
  const ranges: [bigint, bigint][] = [];
  for (let from = c.next; from <= head; from += CHUNK) ranges.push([from, from + CHUNK - 1n > head ? head : from + CHUNK - 1n]);
  const parts = await Promise.all(ranges.map(([fromBlock, toBlock]) =>
    publicClient.getContractEvents({ address, abi, eventName, fromBlock, toBlock, strict: true } as any)));
  const next = { next: head + 1n, logs: [...c.logs, ...parts.flat()] };
  logCache.set(key, next);
  return next.logs;
}

export async function noteAddresses(): Promise<Address[]> {
  const logs = await eventsSince(factoryAddress, factoryAbi, "NoteCreated");
  return logs.map((l: any) => l.args.note as Address).reverse(); // newest first
}

type Fixed = Pick<NoteInfo, "name" | "seller" | "faceValue" | "fundableAt" | "fundingDeadline" | "dueDate" | "graceSeconds" | "discountBps" | "minTier" | "nullifier">;
const fixedCache = new Map<string, Fixed>(); // these fields are immutable in the contract, so read them once

export async function loadNote(address: Address): Promise<NoteInfo> {
  const r = (fn: string, args: unknown[] = []) => publicClient.readContract({ address, abi: noteAbi, functionName: fn, args }) as Promise<any>;
  let fixed = fixedCache.get(address);
  if (!fixed) {
    const [name, seller, faceValue, fundableAt, fundingDeadline, dueDate, graceSeconds, discountBps, minTier, nullifier] = await Promise.all([
      r("name"), r("seller"), r("faceValue"), r("fundableAt"), r("fundingDeadline"), r("dueDate"), r("graceSeconds"), r("discountBps"), r("minTier"), r("nullifier"),
    ]);
    fixed = {
      name, seller, faceValue, fundableAt: Number(fundableAt), fundingDeadline: Number(fundingDeadline), dueDate: Number(dueDate),
      graceSeconds: Number(graceSeconds), discountBps: Number(discountBps), minTier: Number(minTier), nullifier,
    };
    fixedCache.set(address, fixed);
  }
  const [phase, fundingClosed, fundedFace, available, totalSupply] = await Promise.all([
    r("phase"), r("fundingClosed"), r("fundedFace"), r("balanceOf", [address]), r("totalSupply"),
  ]);
  return { address, ...fixed, phase: PHASES[Number(phase)], fundingClosed, fundedFace, available, totalSupply };
}

export const noteBalance = (note: Address, who: Address) =>
  publicClient.readContract({ address: note, abi: noteAbi, functionName: "balanceOf", args: [who] }) as Promise<bigint>;
export const quote = (note: Address, amount: bigint) =>
  publicClient.readContract({ address: note, abi: noteAbi, functionName: "quote", args: [amount] }) as Promise<bigint>;
export const usdtBalance = (who: Address) =>
  publicClient.readContract({ address: usdtAddress, abi: usdtAbi, functionName: "balanceOf", args: [who] }) as Promise<bigint>;
export const wbtBalance = (who: Address) => publicClient.getBalance({ address: who });

export async function explainTransfer(note: Address, from: Address, to: Address, amount: bigint): Promise<{ ok: boolean; why: string }> {
  const [ok, why] = (await publicClient.readContract({ address: note, abi: noteAbi, functionName: "explainTransfer", args: [from, to, amount] })) as [boolean, string];
  return { ok, why };
}

export interface Eligibility {
  reason: (typeof REASONS)[number];
  tier: number;
  validUntil: number;
  attester?: Address;
  credId?: `0x${string}`;
}
export async function eligibilityOf(who: Address): Promise<Eligibility> {
  const [res, cred] = await Promise.all([
    publicClient.readContract({ address: attestersAddress, abi: attestersAbi, functionName: "eligibility", args: [who] }) as Promise<[number, number]>,
    publicClient.readContract({ address: attestersAddress, abi: attestersAbi, functionName: "credentialOf", args: [who] }) as Promise<readonly [Address, number, number, bigint, `0x${string}`]>,
  ]);
  const has = cred[0] !== "0x0000000000000000000000000000000000000000";
  return {
    reason: REASONS[res[0]], tier: Number(res[1]), validUntil: has ? Number(cred[3]) : 0,
    attester: has ? cred[0] : undefined, credId: has ? cred[4] : undefined,
  };
}

// ---------- number and time formatting ----------
export function usdt(v: bigint): string {
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${whole.toLocaleString("en-IN")}.${frac}`;
}
export { parseUsdt } from "./amount";
export function when(ts: number): string {
  return new Date(ts * 1000).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
export function span(secs: number): string {
  const s = Math.abs(Math.round(secs));
  if (s < 90) return `${s} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${(s / 3600).toFixed(1).replace(/\.0$/, "")} h`;
  return `${Math.round(s / 86400)} days`;
}


// ---------- one invoice's history ----------
/** Reads the invoice's own events (registry bind, note creation, everything the note did) and turns them into plain steps. */
export async function loadTimeline(n: NoteInfo): Promise<Step[]> {
  const head = await publicClient.getBlockNumber();
  const chunks = (from: bigint) => { const r: [bigint, bigint][] = []; for (let f = from; f <= head; f += CHUNK) r.push([f, f + CHUNK - 1n > head ? head : f + CHUNK - 1n]); return r; };
  const created = (await eventsSince(factoryAddress, factoryAbi, "NoteCreated")).find((l: any) => String(l.args.note).toLowerCase() === n.address.toLowerCase());
  const noteFrom: bigint = created?.blockNumber ?? (await startBlock());
  const bound = await Promise.all(chunks(await startBlock()).map(([fromBlock, toBlock]) =>
    publicClient.getContractEvents({ address: registryAddress, abi, eventName: "InvoiceBound", args: { nullifier: n.nullifier }, fromBlock, toBlock, strict: true } as any)));
  const own = await Promise.all(chunks(noteFrom).map(([fromBlock, toBlock]) =>
    publicClient.getContractEvents({ address: n.address, abi: noteAbi, fromBlock, toBlock, strict: true } as any)));
  const raw = [...bound.flat(), ...(created ? [created] : []), ...own.flat()] as any[];
  const blocks = [...new Set(raw.map((l) => l.blockNumber as bigint))];
  const times = new Map<bigint, number>();
  await Promise.all(blocks.map(async (b) => times.set(b, Number((await publicClient.getBlock({ blockNumber: b })).timestamp))));
  const events: RawEvent[] = raw.map((l) => ({ name: l.eventName, args: l.args ?? {}, blockNumber: l.blockNumber, logIndex: l.logIndex, txHash: l.transactionHash, at: times.get(l.blockNumber) }));
  return buildTimeline(events, (a) => nameOf(a), n.address);
}
