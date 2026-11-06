// Cases the circuit must refuse: each one makes `nargo execute` fail, so no proof can be made.
// Usage: node zk/scripts/negative.mjs   (needs nargo on PATH; uses the fixtures under contracts/test/fixtures)
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";

const OWNER = "0xDFa97bfe5d2b2E8169b194eAA78Fbb793346B174";
const NIC = ["contracts/test/fixtures/nic-sample.token", "contracts/test/fixtures/nic-sample.modulus.hex", "false"];
const DEMO = (name) => [`contracts/test/fixtures/demo-irp/${name}.token`, "contracts/test/fixtures/demo-irp/demo-irp.modulus.hex", "true"];
const toml = "zk/khata_zk/Prover.toml";

function inputs([token, mod, demo], mutate) {
  let t = token;
  if (typeof mutate === "function" && mutate.length === 1 && mutate.kind === "token") t = mutate(token);
  execFileSync("node", ["zk/scripts/inputs.mjs", t, mod, demo, OWNER, toml], { stdio: "pipe" });
}
const run = () => spawnSync("nargo", ["execute"], { cwd: "zk/khata_zk", encoding: "utf8" });
const failsWith = (r, re) => r.status !== 0 && re.test(r.stdout + r.stderr);
let n = 0;
const check = (name, ok) => { assert.ok(ok, name); n++; console.log("PASS ", name); };

// control: the unmodified sample proves
inputs(NIC);
check("control: the NIC sample executes", run().status === 0);

// a changed byte in the signed payload breaks the signature
inputs(NIC);
let t = readFileSync(toml, "utf8");
const m = t.match(/storage = \[(.*)\]/);
const arr = m[1].split(", ").map(Number);
arr[300] = arr[300] === 65 ? 66 : 65;
writeFileSync(toml, t.replace(m[0], `storage = [${arr.join(", ")}]`));
let r = run();
check("a changed payload byte is refused", r.status !== 0);

// a different modulus than the one that signed
inputs(NIC);
t = readFileSync(toml, "utf8");
t = t.replace(/modulus = \["(\d+)"/, (_, a) => `modulus = ["${BigInt(a) ^ 1n}"`);
writeFileSync(toml, t);
check("a changed modulus limb is refused", run().status !== 0);

// a credit note is not an invoice
inputs(DEMO("demo-credit-note"));
r = run();
check("a credit note is refused", r.status !== 0);

// positions pointing at the wrong field
inputs(NIC);
t = readFileSync(toml, "utf8");
writeFileSync(toml, t.replace(/irn = (\d+)/, (_, a) => `irn = ${Number(a) + 1}`));
check("an IRN position that is not the IRN is refused", run().status !== 0);

inputs(NIC);
t = readFileSync(toml, "utf8");
writeFileSync(toml, t.replace(/payload_start = (\d+)/, (_, a) => `payload_start = ${Number(a) + 4}`));
check("a shifted payload start is refused", run().status !== 0);

// restore the control inputs so the working tree is left usable
inputs(NIC);
console.log(`\n${n} circuit checks passed`);
