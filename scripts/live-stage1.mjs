// Live regression for the signature core on Whitechain Sepolia. Every claim is read back from the chain.
// Usage: npm run live:stage1   (needs .env with a funded DEPLOYER_PRIVATE_KEY and `forge build` output)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { clients, deployment, registryAbi, revertName, root } from "./lib/chain.mjs";

const { publicClient, walletClient, account } = clients();
const dep = deployment();
const address = dep.KhataRegistry;
const abi = registryAbi();
const explorer = (hash) => `${dep.explorer}/tx/${hash}`;
const fixture = (p) => readFileSync(join(root, "contracts/test/fixtures", p), "utf8").trim();

const results = [];
const record = (name, extra = "") => {
  results.push(name);
  console.log(`PASS  ${name}${extra ? "  " + extra : ""}`);
};

/** Flips one character inside the payload part of a token. */
function tamper(token) {
  const i = token.indexOf(".") + 40;
  const c = token[i] === "A" ? "B" : "A";
  return token.slice(0, i) + c + token.slice(i + 1);
}

async function inspect(token) {
  return publicClient.readContract({ address, abi, functionName: "inspect", args: [token] });
}

async function expectCallRevert(token, errorName) {
  try {
    await publicClient.simulateContract({ address, abi, functionName: "bindInvoice", args: [token], account });
  } catch (err) {
    const r = revertName(err);
    assert.equal(r?.name, errorName, `expected ${errorName}, got ${r?.name ?? err.shortMessage}`);
    return;
  }
  assert.fail(`expected ${errorName}, but the call succeeded`);
}

/** Sends the transaction even though it will revert (explicit gas skips estimation) so it lands on-chain. */
async function sendReverting(token) {
  const hash = await walletClient.writeContract({ address, abi, functionName: "bindInvoice", args: [token], gas: 3_000_000n });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "reverted");
  return { hash, receipt };
}

async function bind(token) {
  const hash = await walletClient.writeContract({ address, abi, functionName: "bindInvoice", args: [token] });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success");
  return { hash, receipt };
}

console.log(`Registry ${address} on chain ${await publicClient.getChainId()}`);
const code = await publicClient.getCode({ address });
assert.ok(code && code !== "0x", "registry has code");

// ---- registered keys ----
for (const kid of ["4DE1544AE695BDC84EC7BC12F2F57F813F44E301", "DEMO-IRP-NOT-GOVERNMENT-1"]) {
  const [, , active] = await publicClient.readContract({ address, abi, functionName: "keyOf", args: [kid] });
  assert.equal(active, true);
  record(`key registered and active: ${kid}`);
}

// ---- 0. red team: a demo-key token that carries a real IRN must not burn the real invoice ----
const sampleForIrn = fixture("nic-sample.token");
{
  const collide = fixture("redteam/collide-nic-irn.token");
  const c = await inspect(collide);
  assert.equal(c.keyIsDemo, true);
  if (!c.alreadyBound) {
    const { hash } = await bind(collide);
    record("demo-signed token carrying the NIC sample IRN bound in the demo namespace", `tx ${explorer(hash)}`);
  }
  const real = await inspect(sampleForIrn);
  assert.notEqual(real.nullifier, c.nullifier, "namespaces differ");
}

// ---- 1. NIC sample: verifies on-chain, binds once ----
const sample = fixture("nic-sample.token");
let r = await inspect(sample);
assert.equal(r.signatureValid, true, "NIC signature verifies on-chain");
assert.equal(r.invoice.docNo, "Test-00df1");
assert.equal(r.invoice.valuePaise, 200n);
record("NIC sample signature verifies on-chain (eth_call)", `IRN ${r.invoice.irn}`);

if (!r.alreadyBound) {
  const { hash, receipt } = await bind(sample);
  record("NIC sample bound", `tx ${explorer(hash)} gas ${receipt.gasUsed}`);
} else {
  console.log("NOTE  NIC sample was bound by an earlier run; skipping the first bind");
}
r = await inspect(sample);
assert.equal(r.alreadyBound, true);
const b = await publicClient.readContract({ address, abi, functionName: "bindings", args: [r.nullifier] });
assert.equal(b[0].toLowerCase(), account.address.toLowerCase());
assert.equal(b[2], 200n);
assert.equal(b[3], r.invoice.irn);
record("binding read back from chain", `binder ${b[0]} value(paise) ${b[2]}`);

// ---- 2. rescan as a second financier: refused ----
await expectCallRevert(sample, "IrnAlreadyFinanced");
{
  const { hash } = await sendReverting(sample);
  record("rescan refused: IrnAlreadyFinanced (call and on-chain revert)", `tx ${explorer(hash)}`);
}

// ---- 3. change one byte: signature check fails ----
const bad = tamper(sample);
await expectCallRevert(bad, "InvalidSignature");
{
  const { hash } = await sendReverting(bad);
  record("tampered token refused: InvalidSignature (call and on-chain revert)", `tx ${explorer(hash)}`);
}
{
  const t = await inspect(bad);
  assert.equal(t.signatureValid, false);
  assert.equal(t.keyRegistered, true);
  assert.equal(t.invoice.docNo, "", "unverified data is not shown");
  record("inspect of tampered token reports signature invalid and shows no invoice data");
}

// ---- red team regressions that are visible on-chain ----
{
  // non-canonical signature text: padded with "=="
  const parts = sample.split(".");
  const padded = `${parts[0]}.${parts[1]}.${parts[2]}==`;
  await expectCallRevert(padded, "MalformedToken");
  record("padded signature text refused: MalformedToken");

  // key hygiene and ownership, called as the owner (the deployer)
  const ownerCall = async (fn, args, errName) => {
    try {
      await publicClient.simulateContract({ address, abi, functionName: fn, args, account });
    } catch (err) {
      assert.equal(revertName(err)?.name, errName);
      return;
    }
    assert.fail(`${fn} should have reverted with ${errName}`);
  };
  const modulus = readFileSync(join(root, "contracts/test/fixtures/nic-sample.modulus.hex"), "utf8").trim();
  await ownerCall("addKey", ["WEAK", modulus, "0x01", false], "InvalidKey");
  record("weak exponent 1 refused at addKey");
  await ownerCall("renounceOwnership", [], "OwnershipCannotBeRenounced");
  record("renounceOwnership refused");
}

// ---- 4. labelled DEMO IRP key ----
const demo = (n) => fixture(`demo-irp/${n}.token`);
r = await inspect(demo("demo-01"));
assert.equal(r.signatureValid, true);
if (!r.alreadyBound) {
  const { hash, receipt } = await bind(demo("demo-01"));
  record("DEMO IRP invoice bound", `tx ${explorer(hash)} gas ${receipt.gasUsed}`);
} else {
  console.log("NOTE  demo-01 was bound by an earlier run");
}
await expectCallRevert(demo("demo-dup-irn"), "IrnAlreadyFinanced");
record("same IRN in a differently signed token refused");
await expectCallRevert(demo("demo-unknown-kid"), "UnknownKey");
record("unknown kid refused");
await expectCallRevert(demo("demo-credit-note"), "InvalidField");
record("credit note (DocTyp CRN) refused");

console.log(`\n${results.length} live checks passed`);
