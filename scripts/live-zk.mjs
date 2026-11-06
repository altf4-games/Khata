// Live test of binding an invoice by zero-knowledge proof on Whitechain Sepolia.
// Makes a fresh demo invoice, proves it natively (Noir + Barretenberg), submits the proof, and reads everything back.
// Usage: npm run live:zk    (needs nargo and bb on PATH, .env demo wallets, and `npm run live:stage2` run once for the seller binding)
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { keccak256, concat, toHex, stringToHex } from "viem";
import { abiOf, clients, deployment, revertName, root, wallet } from "./lib/chain.mjs";
import { irnFor, signToken } from "./lib/irp.mjs";

const dep = deployment();
const s2 = dep.stage2;
const { publicClient } = clients();
const reg = { address: s2.KhataRegistry, abi: abiOf("KhataRegistry") };
const factory = { address: s2.KhataFactory, abi: abiOf("KhataFactory") };
const SUPPLIER = wallet("SUPPLIER");
const RIVAL = wallet("INVESTOR");
const txs = [];
let checks = 0;
const link = (h) => `${dep.explorer}/tx/${h}`;
const ok = (m, x = "") => { checks++; console.log(`PASS  ${m}${x ? "  " + x : ""}`); };

async function send(label, w, fn, args, opts = {}, target = reg) {
  const hash = await w.client.writeContract({ address: target.address, abi: target.abi, functionName: fn, args, ...opts });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  txs.push({ label, hash, status: receipt.status, gas: receipt.gasUsed.toString() });
  return { hash, receipt };
}

// ---- a fresh demo invoice, so its nullifier has never been bound ----
const pem = readFileSync(join(root, "contracts/test/fixtures/demo-irp/demo-irp.private.pem"), "utf8");
const docNo = `Z${Math.floor(Date.now() / 1000)}`.slice(0, 16);
const f = { SellerGstin: "27DEMOS1234A1Z5", BuyerGstin: "29DEMOB5678C1Z2", DocNo: docNo, DocTyp: "INV", DocDt: "06/11/2026", TotInvVal: 31000, ItemCnt: 1, MainHsnCode: "010190" };
f.Irn = irnFor({ sellerGstin: f.SellerGstin, docNo, docDt: f.DocDt });
f.IrnDt = "2026-11-06 15:00:00";
const token = signToken(pem, f);
const tokenFile = join(root, "logs/zk-live-token.txt");
writeFileSync(tokenFile, token);
const irn = "0x" + f.Irn;
const expectedNullifier = keccak256(concat([stringToHex("KHATA_DEMO_IRN_V1"), irn]));

// ---- prove natively ----
const owner = SUPPLIER.account.address;
const t0 = Date.now();
execFileSync("node", ["zk/scripts/inputs.mjs", tokenFile, "contracts/test/fixtures/demo-irp/demo-irp.modulus.hex", "true", owner, "zk/khata_zk/Prover.toml"], { cwd: root, stdio: "pipe" });
const sh = (cmd, args) => execFileSync(cmd, args, { cwd: join(root, "zk/khata_zk"), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
sh("nargo", ["execute"]);
sh("bb", ["prove", "-b", "target/khata_zk.json", "-w", "target/khata_zk.gz", "-o", "target", "--oracle_hash", "keccak"]);
const proofMs = Date.now() - t0;
const proof = toHex(readFileSync(join(root, "zk/khata_zk/target/proof")));
const rawInputs = readFileSync(join(root, "zk/khata_zk/target/public_inputs"));
const inputs = Array.from({ length: rawInputs.length / 32 }, (_, i) => toHex(rawInputs.subarray(i * 32, i * 32 + 32)));
assert.equal(inputs.length, 25);
ok("proof made natively from the signed invoice", `${(proofMs / 1000).toFixed(1)} s including witness, ${(proof.length - 2) / 2} bytes`);

// the contract's verifier is deployed with the registry
const zkVerifier = await publicClient.readContract({ ...reg, functionName: "zkVerifier" });
assert.equal(zkVerifier.toLowerCase(), s2.HonkVerifier.toLowerCase());
ok("the registry points at the deployed, explorer-verified HonkVerifier", `${s2.HonkVerifier}`);

async function expectRevert(label, w, args, errorName) {
  try {
    await publicClient.simulateContract({ ...reg, functionName: "bindInvoiceZk", args, account: w.account });
  } catch (err) {
    const r = revertName(err);
    assert.equal(r?.name, errorName, `${label}: expected ${errorName}, got ${r?.name ?? err.shortMessage}`);
    const { hash, receipt } = await send(`${label} (refused)`, w, "bindInvoiceZk", args, { gas: 3_000_000n });
    assert.equal(receipt.status, "reverted");
    ok(`${label}: refused with ${errorName}`, `tx ${link(hash)}`);
    return;
  }
  assert.fail(`${label}: expected a revert`);
}

// ---- refusals first ----
await expectRevert("another wallet replays the proof", RIVAL, [proof, inputs], "ProofNotForCaller");
const bigger = [...inputs]; bigger[24] = toHex(31000_00n * 100n, { size: 32 });
// a changed public input fails inside the verifier, which reverts with its own error
try { await publicClient.simulateContract({ ...reg, functionName: "bindInvoiceZk", args: [proof, bigger], account: SUPPLIER.account }); assert.fail("should revert"); }
catch (err) { assert.notEqual(err.name, "AssertionError"); }
{
  const { hash, receipt } = await send("proof with a larger value claimed (refused)", SUPPLIER, "bindInvoiceZk", [proof, bigger], { gas: 3_000_000n });
  assert.equal(receipt.status, "reverted");
  ok("a proof with the value changed to a larger one: refused by the verifier", `tx ${link(hash)}`);
}
const badKey = [...inputs]; badKey[0] = toHex(BigInt(inputs[0]) ^ 1n, { size: 32 });
await expectRevert("a proof under a modulus that is no registered key", SUPPLIER, [proof, badKey], "UnknownZkKey");

// ---- the real binding ----
const { hash, receipt } = await send("bind by proof", SUPPLIER, "bindInvoiceZk", [proof, inputs]);
assert.equal(receipt.status, "success");
const b = await publicClient.readContract({ ...reg, functionName: "bindings", args: [expectedNullifier] });
assert.equal(b[0].toLowerCase(), owner.toLowerCase());
assert.equal(b[2], 31000n * 100n);
assert.equal(b[3], "0x" + "00".repeat(32));
ok("bound by proof: the nullifier is the one the plain path would compute, the IRN is stored as zero, value read back", `tx ${link(hash)} gas ${receipt.gasUsed}`);

// the calldata carries no IRN and no token
const tx = await publicClient.getTransaction({ hash });
assert.ok(!tx.input.toLowerCase().includes(f.Irn.toLowerCase()), "the IRN must not be in the calldata");
assert.ok(!tx.input.includes(Buffer.from(f.DocNo).toString("hex")), "the document number must not be in the calldata");
ok("the transaction's calldata holds neither the IRN nor the document number", `${(tx.input.length - 2) / 2} bytes of calldata`);

// ---- after the binding ----
await expectRevert("the same proof submitted again", SUPPLIER, [proof, inputs], "IrnAlreadyFinanced");
try { await publicClient.simulateContract({ ...reg, functionName: "bindInvoice", args: [token], account: SUPPLIER.account }); assert.fail("should revert"); }
catch (err) { assert.equal(revertName(err)?.name, "IrnAlreadyFinanced"); }
{
  const { hash: h2, receipt: r2 } = await send("plain bind of the same invoice after the proof (refused)", SUPPLIER, "bindInvoice", [token], { gas: 1_500_000n });
  assert.equal(r2.status, "reverted");
  ok("the same invoice by the plain path afterwards: refused with IrnAlreadyFinanced", `tx ${link(h2)}`);
}

// ---- a note can be made from a proof-bound invoice ----
const due = BigInt(Math.floor(Date.now() / 1000) + 3600);
const { hash: h3, receipt: r3 } = await send("create note from the proof-bound invoice", SUPPLIER, "createNote", [expectedNullifier, { dueDate: due, fundingDeadline: due - 60n, graceSeconds: 60n, discountBps: 300, minTier: 1 }], {}, factory);
assert.equal(r3.status, "success");
const note = await publicClient.readContract({ ...factory, functionName: "noteOf", args: [expectedNullifier] });
ok("a note was created from the proof-bound invoice", `note ${note} tx ${link(h3)}`);

console.log(`\n${checks} zero-knowledge live checks passed`);
writeFileSync(join(root, "logs/live-zk-txs.json"), JSON.stringify(txs, null, 2));
writeFileSync(join(root, "deployments/evidence-zk.json"), JSON.stringify({ chainId: dep.chainId, KhataRegistry: s2.KhataRegistry, HonkVerifier: s2.HonkVerifier, nullifier: expectedNullifier, generatedBy: "npm run live:zk", entries: txs.map(({ label, hash, status }) => ({ label, hash, status })) }, null, 2));
