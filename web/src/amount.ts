const ONE = 1_000_000n; // the notes are 6-decimal, like the prize USDT

/** Reads a USDT amount such as "1" or "0.475" (up to 6 decimals). Anything else is undefined. */
export function parseUsdt(text: string): bigint | undefined {
  const m = text.trim().match(/^(\d+)(?:\.(\d{1,6}))?$/);
  if (!m) return undefined;
  return BigInt(m[1]) * ONE + BigInt((m[2] ?? "").padEnd(6, "0") || "0");
}

/** What the Buy box shows before the visitor types: one note, or whatever is left when less than one note is left. */
export function buyDefault(available: bigint): string {
  const v = available < ONE ? available : ONE;
  const frac = (v % ONE).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${v / ONE}.${frac}` : `${v / ONE}`;
}

/** The amount Buy prices and sends: what the visitor typed, or the default the box is showing if they have not typed. */
export function buyAmount(typed: string | undefined, available: bigint): bigint | undefined {
  return parseUsdt((typed ?? buyDefault(available)).trim());
}
