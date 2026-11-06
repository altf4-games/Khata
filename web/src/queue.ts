// Small helpers that keep the app's actions well formed.

const chains = new Map<string, Promise<unknown>>();

/**
 * Runs `fn` after every earlier call with the same key has finished, so one wallet never has two transactions being built
 * at once (they would take the same nonce and one would fail with a raw "nonce too low").
 */
export function oneAtATime<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const k = key.toLowerCase();
  const prev = chains.get(k) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  const tail = next.catch(() => undefined);
  chains.set(k, tail);
  void tail.then(() => { if (chains.get(k) === tail) chains.delete(k); });
  return next;
}

/** A whole number written plainly (no fraction, exponent or sign) between `min` and `max`, or undefined. */
export function wholeIn(text: string, min: number, max: number): number | undefined {
  const t = text.trim();
  if (!/^[0-9]{1,6}$/.test(t)) return undefined;
  const n = Number(t);
  return n >= min && n <= max ? n : undefined;
}
