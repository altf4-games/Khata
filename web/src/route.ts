/**
 * Arkiv's gateway answers requests that arrive over the Nym route with "HTTP 415: Content-Type: application/json is required"
 * (the same request answers 200 directly and over Tor). So on Nym the app reads Arkiv directly, counts those reads as direct,
 * and says so on the status chip; on Tor everything stays on the private route.
 */
export function nymCannotCarry(network: string, url: string): boolean {
  if (network !== "Nym") return false;
  try {
    const host = new URL(url).hostname;
    return host === "arkiv.network" || host.endsWith(".arkiv.network");
  } catch {
    return false;
  }
}
