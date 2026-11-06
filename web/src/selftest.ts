// Two small checks on the private route, kept free of the Anon-RPC worker itself so they can be tested with stand-in fetches.

type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** The self-test, tried a few times: the first read through a fresh Nym tunnel sometimes goes unanswered and the next one works. */
export async function routeSelfTestWithRetries(f: Fetcher, rpcUrl: string, chainId: number, tries = 2, pauseMs = 1000, timeoutMs = 12_000): Promise<void> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await routeSelfTest(f, rpcUrl, chainId, timeoutMs); } catch (e) { last = e; }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, pauseMs));
  }
  throw last;
}

/** One tiny read through the route before it is called ready: it must come back as a real chain id for the chain we expect. */
export async function routeSelfTest(f: Fetcher, rpcUrl: string, chainId: number, timeoutMs = 12_000): Promise<void> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] });
  const call = f(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body });
  const timer = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("The private route did not answer a test read in time")), timeoutMs));
  const res = await Promise.race([call, timer]);
  if (!res.ok) throw new Error(`The private route answered the test read with HTTP ${res.status}`);
  let id: unknown;
  try { id = JSON.parse(await res.text())?.result; } catch { throw new Error("The private route returned something that is not JSON-RPC"); }
  if (typeof id !== "string" || Number(id) !== chainId) throw new Error(`The private route returned chain ${String(id)}, expected ${chainId}`);
}

export interface Seen { direct?: string; viaRoute?: string; error?: string }

/**
 * What an outside service sees as your address, asked twice: straight from this browser and through the private route.
 * Both answers come from the same echo service; the two should differ when the route works. This is a diagnostic the visitor
 * starts: it is not a chain read and it is not counted in the share.
 */
export async function whatTheRpcSaw(direct: () => Promise<string>, viaRoute: () => Promise<string>): Promise<Seen> {
  const out: Seen = {};
  const [d, r] = await Promise.allSettled([direct(), viaRoute()]);
  if (d.status === "fulfilled") out.direct = d.value;
  if (r.status === "fulfilled") out.viaRoute = r.value;
  if (d.status === "rejected" || r.status === "rejected") {
    out.error = r.status === "rejected" ? "The private route could not fetch the test page." : "This browser could not fetch the test page.";
  }
  return out;
}

/** The verdict in words, for the privacy page. */
export function verdictOf(s: Seen): { ok: boolean; text: string } {
  if (s.direct && s.viaRoute) {
    return s.direct !== s.viaRoute
      ? { ok: true, text: `Direct, the echo service sees ${s.direct}. Through the private route it sees ${s.viaRoute}, not you.` }
      : { ok: false, text: `Both requests show ${s.direct}. The route is not hiding this browser's address.` };
  }
  if (s.viaRoute) return { ok: true, text: `Through the private route the echo service sees ${s.viaRoute}. The direct request failed, so there is nothing to compare it with.` };
  return { ok: false, text: s.error ?? "No answer." };
}
