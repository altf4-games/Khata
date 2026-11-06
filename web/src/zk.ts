// Proves, in this browser, that a government key signed an invoice, without sending the invoice anywhere. The proving
// libraries and the circuit are large, so they are only loaded when a visitor asks for a private binding.
import { Buffer } from "buffer";
import type { Hex } from "viem";
import type { CircuitInput } from "./zk-inputs";

export interface Proof {
  proof: Hex;
  inputs: Hex[];
}

const toHex = (b: Uint8Array): Hex => ("0x" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("")) as Hex;

// the proving libraries expect Node's Buffer
(globalThis as { Buffer?: unknown }).Buffer ??= Buffer;

export async function proveInvoice(input: CircuitInput, onStatus: (note: string) => void): Promise<Proof> {
  onStatus("Loading the proving system…");
  const [{ Noir }, { UltraHonkBackend }, circuit] = await Promise.all([
    import("@noir-lang/noir_js"),
    import("@aztec/bb.js"),
    import("./zk/khata_zk.json"),
  ]);
  const program = (circuit as { default: { bytecode: string } }).default;
  onStatus("Checking the invoice and its signature inside the circuit…");
  const { witness } = await new Noir(program as never).execute(input as never);
  onStatus("Making the proof. It runs only in this browser, and takes up to a minute…");
  // several threads need a cross-origin isolated page; without one a single thread is used
  const threads = typeof crossOriginIsolated !== "undefined" && crossOriginIsolated ? Math.min(navigator.hardwareConcurrency || 4, 8) : 1;
  const backend = new UltraHonkBackend(program.bytecode, { threads });
  try {
    const p = await backend.generateProof(witness, { keccakZK: true });
    if (!(await backend.verifyProof(p, { keccakZK: true }))) throw new Error("The proof did not verify, so it was not sent.");
    return { proof: toHex(p.proof), inputs: p.publicInputs.map((x) => (x.startsWith("0x") ? x : "0x" + BigInt(x).toString(16).padStart(64, "0"))) as Hex[] };
  } finally {
    await backend.destroy();
  }
}
