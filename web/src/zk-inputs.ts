// Builds the inputs of the zero-knowledge circuit (zk/khata_zk) from a NIC token, in the browser, so the token never leaves the page.
// The same construction as zk/scripts/inputs.mjs, which produced the proofs the contract has accepted; a test keeps them equal.
export const MAX_SIGNED = 704;
const LIMB_BITS = 120n;

const b64u = (s: string): Uint8Array => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

/** 18 limbs of 120 bits, least significant first, as decimal strings. */
export function limbsOf(x: bigint): string[] {
  return Array.from({ length: 18 }, (_, i) => ((x >> (LIMB_BITS * BigInt(i))) & ((1n << LIMB_BITS) - 1n)).toString());
}

export interface CircuitInput {
  data: { storage: string[]; len: string };
  payload_start: string;
  modulus: string[];
  redc: string[];
  signature: string[];
  pos: { gstin: string; doctyp: string; value: string; value_len: string; irn: string };
  owner: string;
  demo: boolean;
}

export function buildCircuitInput(token: string, modulusHex: `0x${string}`, owner: string, demo: boolean): CircuitInput {
  const [h, p, s] = token.trim().split(".");
  if (!h || !p || !s) throw new Error("That is not a signed invoice token.");
  const signed = `${h}.${p}`;
  if (signed.length > MAX_SIGNED) throw new Error(`This invoice's signed text is ${signed.length} bytes, too long for the proof circuit (at most ${MAX_SIGNED}).`);

  const n = BigInt(modulusHex);
  if (n >> 2047n !== 1n) throw new Error("Proofs work only with 2048-bit signing keys, and this invoice's key is a different size. Finance it with the ordinary path.");
  const sig = BigInt("0x" + hex(b64u(s)));
  if (sig >= n) throw new Error("The invoice's signature does not fit its key, so it cannot be proved.");
  const redc = (1n << (2n * 2048n + 4n)) / n; // the Barrett parameter the big-number library expects

  // one character per byte, so every index below is a byte offset, which is what the circuit reads (UTF-8 text such as a
  // seller name in Devanagari or with diacritics would otherwise shift every later position)
  const payload = Array.from(b64u(p), (b) => String.fromCharCode(b)).join("");
  const after = (needle: string) => {
    const i = payload.indexOf(needle);
    if (i < 0) throw new Error(`The invoice has no ${needle.replace(/\\"/g, "").replace(/:.*/, "")} field.`);
    return i + needle.length;
  };
  const valueStart = after('\\"TotInvVal\\":');
  const valueEnd = payload.indexOf(",", valueStart);
  if (valueEnd < 0) throw new Error("This invoice lists its value last, which the proof circuit does not read. Finance it with the ordinary path.");
  const storage = Array.from({ length: MAX_SIGNED }, (_, i) => String(i < signed.length ? signed.charCodeAt(i) : 0));
  return {
    data: { storage, len: String(signed.length) },
    payload_start: String(h.length + 1),
    modulus: limbsOf(n),
    redc: limbsOf(redc),
    signature: limbsOf(sig),
    pos: {
      gstin: String(after('\\"SellerGstin\\":\\"')),
      doctyp: String(after('\\"DocTyp\\":\\"')),
      value: String(valueStart),
      value_len: String(valueEnd - valueStart),
      irn: String(after('\\"Irn\\":\\"')),
    },
    owner: BigInt(owner).toString(),
    demo,
  };
}
