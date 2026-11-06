// Pins the identity of each Anon-RPC worker. The harness runs a worker only if its code hashes to the specifier contract's
// workerHash(), but the contract's owner can change that hash. These are the hashes read from the contracts on Ethereum mainnet
// on 2026-11-06 (`cast call <specifier> "workerHash()(bytes32)"`), so a later change makes this app refuse to start rather than
// run code nobody here looked at. Trust on first use: updating a pin is a deliberate edit to this file.
export const PINS: Record<string, string> = {
  "0x700da3193d35fa54cd3fbf29b66f2a2a0385659e": "0x5b62f358ce7a2b94ee9bc3a0e6a08757db68fa08fc348276f31eda788aec818b", // tor-js
  "0x3acd9742c68f6d993066ae25533e09b9e1f60ed0": "0xf13a448a8721b9d0b20da3d5b80ffe00bf4c5bb3aae812a38d3d1e3bc81fceb8", // Nym
};

/** Selector of `workerHash()`. */
export const WORKER_HASH_SELECTOR = "0x3898587d";

/** Throws if `result` is the answer to a `workerHash()` call on a pinned specifier and is not the pinned hash. */
export function checkPin(to: string, data: string, result: string): void {
  if (!data.toLowerCase().startsWith(WORKER_HASH_SELECTOR)) return;
  const pinned = PINS[to.toLowerCase()];
  if (!pinned) return;
  if (result.toLowerCase() !== pinned) {
    throw new Error("The Anon-RPC worker's published hash has changed since it was reviewed, so it was not started.");
  }
}
