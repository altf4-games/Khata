// Shared app state, data refresh and the one place transactions are run from.
import type { Address } from "viem";
import { attestersAbi, attestersAddress, revertInfo } from "./chain";
import { refusalFor } from "./errors";
import {
  eligibilityOf, eventsSince, loadNote, nowChain, noteAddresses, noteBalance, usdtBalance, wbtBalance,
  type Eligibility, type NoteInfo,
} from "./notes";
import { walletsFor, wallets, type DemoWallet, type Role } from "./wallets";
import type { Sent } from "./tx";
import { doneMsg, type ChainName } from "./outcome";
import { loadArkiv, type ArkivSnapshot } from "./arkivApp";
import { ArkivUnavailable } from "./arkiv";

export interface Msg {
  kind: "busy" | "ok" | "bad";
  title: string;
  detail?: string;
  hash?: string;
  chain?: ChainName;
}

export interface IssuedCredential {
  subject: Address;
  attester: Address;
  credId: `0x${string}`;
  validUntil: number;
  tx: string;
}

export const store = {
  role: "supplier" as Role,
  pick: {} as Record<string, number>, // which wallet of a role is active
  notes: [] as NoteInfo[],
  chainNow: 0,
  refreshedAt: Date.now(),
  loading: false,
  loaded: false,
  showAll: false,
  loadError: "",
  elig: {} as Record<string, Eligibility>,
  bal: {} as Record<string, { usdt: bigint; wbt: bigint }>,
  hold: {} as Record<string, bigint>, // `${note}:${address}`
  issued: [] as IssuedCredential[],
  msgs: {} as Record<string, Msg>,
  form: {} as Record<string, string>,
  arkiv: undefined as ArkivSnapshot | undefined,
  arkivError: "",
};

let renderFn: () => void = () => {};
export const setRender = (f: () => void) => (renderFn = f);
export const rerender = () => renderFn();

export function activeWallet(role: Role = store.role): DemoWallet | undefined {
  const list = walletsFor(role);
  return list[Math.min(store.pick[role] ?? 0, list.length - 1)];
}

export const holdKey = (note: string, who: string) => `${note}:${who}`.toLowerCase();

let seq = 0;
/** A first load that fails on a flaky RPC tries again by itself, a few seconds apart, before it shows an error. */
const AUTO_RETRIES = 2;
const AUTO_RETRY_MS = 3000;
export async function refresh(attempt = 0) {
  const mine = ++seq;
  let retrying = false;
  store.loading = true;
  rerender();
  try {
    const [addrs, now] = await Promise.all([noteAddresses(), nowChain()]);
    // Keep the load light on the public RPC: the newest notes only (unless all are asked for), and balances
    // and holdings only for the wallet in use. Eligibility is read for every demo wallet (the transfer list shows it).
    const notes = await Promise.all((store.showAll ? addrs : addrs.slice(0, 8)).map(loadNote));
    const elig: typeof store.elig = {};
    const bal: typeof store.bal = { ...store.bal };
    const hold: typeof store.hold = { ...store.hold };
    const current = activeWallet();
    await Promise.all([
      ...wallets.map(async (w) => { elig[w.address.toLowerCase()] = await eligibilityOf(w.address); }),
      ...(current ? [
        (async () => { bal[current.address.toLowerCase()] = { usdt: await usdtBalance(current.address), wbt: await wbtBalance(current.address) }; })(),
        ...notes.map(async (n) => { hold[holdKey(n.address, current.address)] = await noteBalance(n.address, current.address); }),
      ] : []),
    ]);
    let issued = store.issued;
    if (store.role === "attester") issued = await loadIssued();
    if (mine !== seq) return;
    void refreshArkiv(now);
    Object.assign(store, { notes, chainNow: now, refreshedAt: Date.now(), elig, bal, hold, issued, loadError: "", loaded: true });
  } catch (e) {
    if (mine !== seq) return;
    if (!store.loaded && attempt < AUTO_RETRIES) {
      retrying = true; // stay in the loading state through the wait
      setTimeout(() => { if (mine === seq) void refresh(attempt + 1); }, AUTO_RETRY_MS);
      return;
    }
    store.loadError = revertInfo(e).message;
  } finally {
    if (mine === seq && !retrying) {
      store.loading = false;
      rerender();
    }
  }
}

async function loadIssued(): Promise<IssuedCredential[]> {
  const logs = await eventsSince(attestersAddress, attestersAbi, "CredentialRegistered");
  return (logs as any[])
    .map((l) => ({ subject: l.args.subject, attester: l.args.attester, credId: l.args.credId, validUntil: Number(l.args.validUntil), tx: l.transactionHash }))
    .reverse();
}

/** Runs one action under a message key: shows progress, then success or a readable refusal, then refreshes. */
export async function run(key: string, busy: string, fn: () => Promise<Sent | undefined>, done: string, detail?: string) {
  store.msgs[key] = { kind: "busy", title: busy };
  rerender();
  try {
    const sent = await fn();
    store.msgs[key] = doneMsg(sent, done, detail);
  } catch (e) {
    const info = revertInfo(e);
    const r = refusalFor(info.name, info.args, info.message);
    store.msgs[key] = { kind: "bad", title: r.title, detail: r.detail };
  }
  await refresh();
}

/** Arkiv is read separately, so an Arkiv outage never hides what the chain says. */
let aseq = 0;
let arkivInFlight: { key: string; p: Promise<void> } | undefined;
export function refreshArkiv(now = nowEst2()): Promise<void> {
  // the same read asked for twice at once (start-up, a poll and a watcher event) is made once
  const key = JSON.stringify([store.form["m:disc"], store.form["m:due"], store.form["m:status"], store.form["m:sort"]]);
  if (arkivInFlight?.key === key) return arkivInFlight.p;
  const p = readArkiv(now).finally(() => { if (arkivInFlight?.p === p) arkivInFlight = undefined; });
  arkivInFlight = { key, p };
  return p;
}
async function readArkiv(now: number) {
  const mine = ++aseq;
  try {
    // a filter, not an order: anything that is not a percentage from 0 to 100 reads as no minimum
    const pctIn = Number(store.form["m:disc"] ?? "0");
    const disc = Number.isFinite(pctIn) && pctIn > 0 ? Math.min(Math.round(pctIn * 100), 10_000) : 0;
    const dueWithin = Number(store.form["m:due"] ?? "0");
    const snap = await loadArkiv(now, {
      minDiscountBps: Number.isFinite(disc) ? disc : 0, status: store.form["m:status"] ?? "open",
      dueWithinSeconds: Number.isFinite(dueWithin) ? dueWithin : 0, sort: (store.form["m:sort"] as "due" | "discount") ?? "due",
    });
    if (mine !== aseq) return;
    store.arkiv = snap;
    store.arkivError = "";
  } catch (e) {
    if (mine !== aseq) return;
    store.arkivError = e instanceof ArkivUnavailable ? e.why : "Arkiv could not be read.";
  }
  rerender();
}
const nowEst2 = () => store.chainNow + Math.floor((Date.now() - store.refreshedAt) / 1000);
