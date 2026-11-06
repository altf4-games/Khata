// The URL parameters that change how reads are routed are test hooks: a different Anon-RPC worker or gateway, a switch to direct
// reads, a shortened deadline. Anyone can craft a link, and a link that swaps the worker hands that worker every read the page makes,
// so these only work on a local development host. Everywhere else they are dropped. (The visitor's own "read directly" button
// is a separate, explicit choice and is not affected.)
const ROUTING = new Set(["anonSpecifier", "anonGateway", "anonNetwork", "anonFallback", "anonBootDeadline", "anonSlowAfter", "reads"]);

/** Exactly localhost, 127.0.0.1, [::1], or a name ending in .localhost. A name that merely contains "localhost" is not local. */
export const isLocalHost = (host: string) => host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");

export function readParams(search: string, host: string): URLSearchParams {
  const all = new URLSearchParams(search);
  if (isLocalHost(host)) return all;
  const kept = new URLSearchParams();
  for (const [k, v] of all) if (!ROUTING.has(k)) kept.append(k, v);
  return kept;
}
