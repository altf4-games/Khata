// Anon-RPC: every read goes through EF's hash-pinned anon-client worker (Tor), by default.
// There is no silent fallback: if the worker cannot start, the page says so and waits for the user to retry or to
// choose direct reads, which are then labelled "not anonymous". Writes are not anonymised: a signed transaction
// is broadcast straight to the node because it names its sender anyway.
import { AnonRpcWorker } from "@anon-rpc/browser-harness";
import { http, type Transport } from "viem";
import { Traffic } from "./traffic";
import { checkPin } from "./pin";
import { readParams } from "./params";
import { waitFor } from "./wait";

/** The tor-js anon-client's on-chain specifier (Ethereum mainnet). Its bytes are checked against `workerHash()` before they run. */
const DEFAULT_SPECIFIER = "0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e";
/** The Nym worker's specifier, from EF's integration guide (https://ethereum.github.io/anon-rpc/wallets/). Its config is `undefined`: no gateway. */
const NYM_SPECIFIER = "0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0";
/**
 * EF's demo gateway for the tor-js worker (ip:port:certhash). The worker has no default gateway. EF describes this one
 * as limited capacity that may disappear at any time, so it is a single point of failure; `?anonGateway=` overrides it.
 */
const DEMO_GATEWAY = "152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ";
/** Only used to read the specifier. It carries no user data, and it is the one read that is not anonymous. */
const BOOTSTRAP_RPC = "https://ethereum-rpc.publicnode.com";

export type AnonState =
  | { kind: "starting"; since: number; lines: string[]; network: string }
  | { kind: "ready"; ms: number; network: string }
  | { kind: "failed"; why: string }
  | { kind: "direct" }; // the user's explicit choice (or ?reads=direct)

const params = readParams(typeof location === "undefined" ? "" : location.search, typeof location === "undefined" ? "localhost" : location.hostname);
const gateway = params.get("anonGateway") ?? DEMO_GATEWAY;
/** After this long still starting, the page offers a choice (a test can shorten it). */
export const slowAfterMs = Number(params.get("anonSlowAfter") ?? 45_000);
const specifier = params.get("anonSpecifier") ?? DEFAULT_SPECIFIER; // a test hook: lets a test point at a worker that cannot boot
/** `?anonNetwork=nym` starts on Nym; `?anonFallback=off` (and any custom specifier) disables the switch, so a test sees the first failure. */
const firstNetwork: "tor" | "nym" = params.get("anonNetwork") === "nym" ? "nym" : "tor";
/** How long Tor may take to become ready before Nym is tried. A normal cold start is 8 to 17 s. */
const bootDeadlineMs = Number(params.get("anonBootDeadline") ?? 40_000);
const fallbackAllowed = params.get("anonFallback") !== "off" && !params.get("anonSpecifier");

export const traffic = new Traffic();
// The visitor's own choice to read directly is remembered in this browser, and only that: a fresh visit starts on Anon-RPC.
const STORE_KEY = "khata.reads";
const remember = (v: "direct" | null) => { try { v ? localStorage.setItem(STORE_KEY, v) : localStorage.removeItem(STORE_KEY); } catch { /* storage may be blocked */ } };
const remembered = () => { try { return localStorage.getItem(STORE_KEY) === "direct"; } catch { return false; } };
export let state: AnonState = params.get("reads") === "direct" || remembered() ? { kind: "direct" } : { kind: "starting", since: Date.now(), lines: [], network: "Tor" };

// two kinds of change: the state (re-render the page) and the counters (update the status chip in place)
const stateListeners = new Set<() => void>();
const trafficListeners = new Set<() => void>();
export const onState = (f: () => void) => (stateListeners.add(f), () => stateListeners.delete(f));
export const onTraffic = (f: () => void) => (trafficListeners.add(f), () => trafficListeners.delete(f));
function set(next: AnonState) {
  state = next;
  stateListeners.forEach((f) => f());
  trafficListeners.forEach((f) => f());
}
const touch = () => trafficListeners.forEach((f) => f());

let worker: AnonRpcWorker | undefined;

async function bootstrapRequest({ method, params }: { method: string; params?: unknown[] }) {
  traffic.excluded("bootstrap");
  const res = await fetch(BOOTSTRAP_RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message ?? "bootstrap read failed");
  // the worker's identity is pinned here: a changed workerHash() stops the worker before it runs
  const call = (params?.[0] ?? {}) as { to?: string; data?: string; input?: string };
  if (method === "eth_call" && call.to) checkPin(call.to, String(call.data ?? call.input ?? ""), String(body.result));
  return body.result;
}

export function startAnon(network: "tor" | "nym" = firstNetwork, since = Date.now(), earlier?: string) {
  worker?.close();
  worker = undefined;
  if (state.kind === "direct") return;
  const name = network === "tor" ? "Tor" : "Nym";
  set({ kind: "starting", since, lines: earlier ? [earlier] : [], network: name });
  const address = network === "tor" ? specifier : NYM_SPECIFIER;
  const config = network === "tor" ? { gateways: [gateway] } : undefined;
  const w = new AnonRpcWorker({ address, ...(config ? { config } : {}), preExisting: { rpcProvider: { request: bootstrapRequest } as never } });
  worker = w;
  // Tor can fail because its demo gateway is unreachable; Nym has no gateway, so it is the one other network to try, once.
  const fail = (why: string, plain = false) => {
    clearTimeout(deadline);
    if (worker !== w) return;
    if (network === "tor" && fallbackAllowed) {
      w.close();
      startAnon("nym", since, plain ? `${why}. Trying Nym instead.` : `Tor could not start (${why}). Trying Nym instead.`);
      return;
    }
    if (state.kind !== "failed") set({ kind: "failed", why });
  };
  const deadline = network === "tor" && fallbackAllowed
    ? setTimeout(() => fail(`Tor did not finish starting in ${Math.round(bootDeadlineMs / 1000)} s`, true), bootDeadlineMs)
    : undefined;
  w.ready.then(
    () => { clearTimeout(deadline); if (worker === w) set({ kind: "ready", ms: Date.now() - since, network: name }); },
    (e) => fail(String((e as Error)?.message ?? e).split("\n")[0]),
  );
  // the worker's own log lines tell the user what the warm-up is doing
  void (async () => {
    try {
      for (;;) {
        const { args } = await w.acceptLog();
        if (state.kind === "starting" && worker === w) {
          const line = args.map(String).join(" ").slice(0, 140);
          console.debug("[anon-rpc]", line);
          // A browser cannot reach Tor without the gateway; once the gateway cannot be dialled the worker can never finish
          // starting, so say so now instead of leaving the user watching a spinner.
          if (network === "tor" && /all gateways failed/i.test(line)) {
            fail(`the gateway ${gateway.split(":").slice(0, 2).join(":")} could not be reached over WebRTC. UDP may be blocked on this network, or EF's demo gateway may be down`);
            return;
          }
          set({ ...state, lines: [...state.lines.slice(-3), line] });
        }
      }
    } catch { /* the worker failed or closed; ready/failed already says so */ }
  })();
}

/**
 * Starting over also clears the worker's saved Tor state. Tor remembers a guard it could not reach and refuses to retry
 * it for minutes, and that memory survives a plain restart (it lives in IndexedDB), so a restart alone just waits again.
 */
export async function retryAnon() {
  worker?.close();
  worker = undefined;
  set({ kind: "starting", since: Date.now(), lines: [], network: firstNetwork === "nym" ? "Nym" : "Tor" });
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase("anon-rpc-harness");
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
    setTimeout(resolve, 3000);
  });
  startAnon();
}
export function chooseDirect() {
  worker?.close();
  worker = undefined;
  remember("direct");
  set({ kind: "direct" });
}
/** Back from direct reads to Anon-RPC. */
export function useAnon() {
  remember(null);
  state = { kind: "starting", since: Date.now(), lines: [], network: firstNetwork === "nym" ? "Nym" : "Tor" };
  startAnon();
}

const methodsOf = (init?: RequestInit): string[] => {
  try {
    const body = JSON.parse(String(init?.body ?? "null"));
    return (Array.isArray(body) ? body : [body]).map((b: any) => String(b?.method ?? "")).filter(Boolean);
  } catch {
    return [];
  }
};

/** The one fetch the app's chain clients use. Reads go through the worker, broadcasts go direct, nothing falls back silently. */
export const routedFetch: typeof fetch = async (input, init) => {
  const methods = methodsOf(init);
  const calls = Math.max(methods.length, 1);
  if (methods.length === 1 && methods[0] === "eth_sendRawTransaction") {
    traffic.excluded("broadcast");
    touch();
    return fetch(input, init);
  }
  if (methods.includes("eth_sendRawTransaction")) throw new Error("A broadcast must not share a request with reads.");
  if (state.kind === "direct") {
    traffic.read("direct", calls);
    touch();
    return fetch(input, init);
  }
  if (state.kind === "failed") throw new Error("Anonymous reads are unavailable. Retry them or choose direct reads.");
  try {
    // during a retry the old worker is gone and the new one is not made yet: wait for it rather than fail
    const w = worker ?? (await waitFor(() => worker, () => (state.kind === "failed" ? "Anonymous reads are unavailable. Retry them or choose direct reads." : state.kind === "direct" ? "Reads switched to direct; try again." : undefined), 60_000));
    const res = await w.fetch(input as string, init as never);
    traffic.read("anon", calls);
    touch();
    return res as Response;
  } catch (e) {
    traffic.failed(calls);
    touch();
    throw e;
  }
};

/** A viem transport for chain reads (and, for wallets, sends: broadcasts are routed direct by `routedFetch`). */
export function chainTransport(url?: string, opts: { batch?: boolean } = {}): Transport {
  return http(url, { fetchFn: routedFetch, batch: opts.batch ?? false, timeout: 60_000, retryCount: 1 });
}

/** Text for the status chip and the title (tooltip) explaining exactly what is and is not covered. */
export function chipText(): { text: string; title: string; tone: "ok" | "wait" | "bad" } {
  const share = traffic.share();
  const s = traffic.snapshot();
  const detail = `Reads through Anon-RPC: ${s.anon}. Direct reads: ${s.direct}. Signed transactions broadcast directly: ${s.broadcast}. One bootstrap read of the worker's on-chain specifier: ${s.bootstrap}.`;
  switch (state.kind) {
    case "starting":
      return { text: "Reads: starting Anon-RPC…", title: "Opening a private route over Tor. Reads wait until it is ready.", tone: "wait" };
    case "ready":
      return { text: `Reads: Anon-RPC (${state.network})${share === undefined ? "" : ` · ${Math.round(share * 100)}% (${s.anon}/${s.anon + s.direct})`}`, title: `${detail} Writes are not anonymised.`, tone: "ok" };
    case "failed":
      return { text: "Reads: unavailable", title: state.why, tone: "bad" };
    case "direct":
      return { text: "Reads: direct · not anonymous", title: `${detail} Your IP address is visible to the RPC providers.`, tone: "bad" };
  }
}
