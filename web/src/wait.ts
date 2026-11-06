// Waits for something that is being (re)started, for example the Anon-RPC worker during a retry, instead of failing on it.

/** Resolves with `get()` once it is defined, rejects with `gone()`'s message when that says to stop, or after `timeoutMs`. */
export async function waitFor<T>(get: () => T | undefined, gone: () => string | undefined, timeoutMs: number, stepMs = 100): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = get();
    if (v !== undefined) return v;
    const why = gone();
    if (why) throw new Error(why);
    if (Date.now() >= until) throw new Error("Anon-RPC is still restarting. Try again in a moment.");
    await new Promise((r) => setTimeout(r, stepMs));
  }
}
