// Builds the circuit's inputs (Prover.toml) from a NIC token and the signer's public key.
// Usage: node zk/scripts/inputs.mjs <token-file> <modulus-hex-file> <demo:true|false> <owner-address> [out.toml]
import { readFileSync, writeFileSync } from "node:fs";

const MAX_SIGNED = 704;
const [tokenFile, modFile, demoArg, owner, out = "zk/khata_zk/Prover.toml"] = process.argv.slice(2);
if (!tokenFile || !modFile || !demoArg || !owner) throw new Error("usage: inputs.mjs <token> <modulus-hex-file> <demo> <owner> [out]");

const token = readFileSync(tokenFile, "utf8").trim();
const [h, p, s] = token.split(".");
const signed = `${h}.${p}`;
if (signed.length > MAX_SIGNED) throw new Error(`signed text is ${signed.length} bytes; the circuit takes at most ${MAX_SIGNED}`);

const n = BigInt(readFileSync(modFile, "utf8").trim().startsWith("0x") ? readFileSync(modFile, "utf8").trim() : "0x" + readFileSync(modFile, "utf8").trim());
const sig = BigInt("0x" + Buffer.from(s, "base64url").toString("hex"));
const limbs = (x) => Array.from({ length: 18 }, (_, i) => ((x >> BigInt(120 * i)) & ((1n << 120n) - 1n)).toString());
const redc = (1n << (2n * 2048n + 4n)) / n; // the Barrett parameter the big-number library expects

// positions of the values inside the decoded payload
// latin1 keeps one character per byte, so indexOf gives the byte offsets the circuit reads
const payload = Buffer.from(p, "base64url").toString("latin1");
const at = (needle) => { const i = payload.indexOf(needle); if (i < 0) throw new Error(`missing ${needle}`); return i + needle.length; };
const tvMarker = '\\"TotInvVal\\":';
const valueStart = at(tvMarker);
const valueEnd = payload.indexOf(",", valueStart);
const pos = {
  gstin: at('\\"SellerGstin\\":\\"'),
  doctyp: at('\\"DocTyp\\":\\"'),
  value: valueStart,
  value_len: valueEnd - valueStart,
  irn: at('\\"Irn\\":\\"'),
};

const storage = Array.from({ length: MAX_SIGNED }, (_, i) => (i < signed.length ? signed.charCodeAt(i) : 0));
const q = (a) => `[${a.map((x) => `"${x}"`).join(", ")}]`;
const toml = `payload_start = ${h.length + 1}
modulus = ${q(limbs(n))}
redc = ${q(limbs(redc))}
signature = ${q(limbs(sig))}
owner = "${BigInt(owner)}"
demo = ${demoArg === "true"}

[data]
storage = [${storage.join(", ")}]
len = ${signed.length}

[pos]
gstin = ${pos.gstin}
doctyp = ${pos.doctyp}
value = ${pos.value}
value_len = ${pos.value_len}
irn = ${pos.irn}
`;
writeFileSync(out, toml);
console.log(`wrote ${out}: ${signed.length} signed bytes, positions`, pos);
