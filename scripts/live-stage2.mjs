// Live regression for the registry, notes and lifecycle on Whitechain Sepolia with the real prize USDT.
// Every claim is read back from the chain. Usage: npm run live:stage2   (needs .env demo wallets and `forge build`)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { domainSeparator, formatUnits, hexToSignature, parseAbi, parseUnits, getAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { abiOf, clients, deployment, revertName, root, wallet } from "./lib/chain.mjs";
import { DEMO_KID, irnFor, signToken } from "./lib/irp.mjs";
import { mergeEvidence } from "./lib/evidence.mjs";
import { randomBytes } from "node:crypto";
// a fresh credential id per run: a reused one may have been superseded by an earlier run and would be refused
const freshId = () => `0x${randomBytes(32).toString("hex")}`;

const dep = deployment();
const s2 = dep.stage2;
const { publicClient, walletClient: ownerClient, account: owner } = clients();
const W = Object.fromEntries(["ATTESTER", "SUPPLIER", "INVESTOR", "INVESTOR2", "DEBTOR"].map((r) => [r, wallet(r)]));
const A = {
  attesters: { address: s2.AttesterRegistry, abi: abiOf("AttesterRegistry") },
  registry: { address: s2.KhataRegistry, abi: abiOf("KhataRegistry") },
  factory: { address: s2.KhataFactory, abi: abiOf("KhataFactory") },
};
const noteAbi = abiOf("KhataNote");
const usdtAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
  "function nonces(address) view returns (uint256)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
]);
const USDT = s2.usdt;
const SELLER_GSTIN = "27DEMOS1234A1Z5";
const txs = [];
let checks = 0;

const link = (h) => `${dep.explorer}/tx/${h}`;
const ok = (msg, extra = "") => { checks++; console.log(`PASS  ${msg}${extra ? "  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chainNow = async () => Number((await publicClient.getBlock()).timestamp);
async function waitUntil(ts, why) {
  while ((await chainNow()) <= ts) await sleep(2000);
  console.log(`      (waited for chain time ${ts}: ${why})`);
}
const bal = (addr) => publicClient.readContract({ address: USDT, abi: usdtAbi, functionName: "balanceOf", args: [addr] });
const u = (n) => formatUnits(n, 6);

async function send(label, role, target, abi, fn, args, opts = {}) {
  const w = role === "OWNER" ? { client: ownerClient, account: owner } : W[role];
  const hash = await w.client.writeContract({ address: target, abi, functionName: fn, args, ...opts });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  txs.push({ label, hash, status: receipt.status, gas: receipt.gasUsed.toString() });
  return { hash, receipt };
}
async function sendOk(label, role, target, abi, fn, args, opts) {
  const r = await send(label, role, target, abi, fn, args, opts);
  assert.equal(r.receipt.status, "success", `${label} should succeed`);
  return r;
}
/** The call must revert with `errorName`; then the same call is sent with fixed gas so the refusal is on-chain. */
async function expectRevert(label, role, target, abi, fn, args, errorName, recordOnChain = true) {
  const w = role === "OWNER" ? { account: owner } : W[role];
  try {
    await publicClient.simulateContract({ address: target, abi, functionName: fn, args, account: w.account });
  } catch (err) {
    const r = revertName(err);
    assert.equal(r?.name, errorName, `${label}: expected ${errorName}, got ${r?.name ?? err.shortMessage}`);
    if (recordOnChain) {
      // bindInvoice verifies and parses before it can refuse, so it needs room to reach its revert; the rest refuse early
      const gas = fn === "bindInvoice" ? 1_500_000n : 500_000n;
      const { hash, receipt } = await send(`${label} (refused)`, role, target, abi, fn, args, { gas });
      assert.equal(receipt.status, "reverted");
      txs[txs.length - 1].reason = errorName; // the reason the simulation gave just before; the receipt alone only says "reverted"
      ok(`${label}: refused with ${errorName}`, `tx ${link(hash)}`);
    } else ok(`${label}: refused with ${errorName}`);
    return r;
  }
  assert.fail(`${label}: expected revert ${errorName} but the call succeeded`);
}
const typedDomain = { name: "KhataAttesters", version: "1", chainId: 1874, verifyingContract: A.attesters.address };

async function ensureUsdt(to, amount) {
  let need = amount - (await bal(to));
  if (need <= 0n) return;
  const sources = [["OWNER", { client: ownerClient, account: owner }], ...Object.entries(W)].filter(([, w]) => w.account.address !== to);
  const funded = await Promise.all(sources.map(async ([role, w]) => [role, await bal(w.account.address)]));
  funded.sort((x, y) => (x[1] > y[1] ? -1 : 1));
  for (const [role, have] of funded) {
    if (need <= 0n) break;
    const part = have < need ? have : need;
    if (part === 0n) continue;
    const { hash } = await sendOk(`move ${u(part)} USDT`, role, USDT, usdtAbi, "transfer", [to, part]);
    console.log(`      (moved ${u(part)} USDT to ${to} from ${role}, tx ${hash})`);
    need -= part;
  }
  if (need > 0n) throw new Error(`the demo wallets together lack ${u(need)} USDT for ${to}`);
}

async function signCredential(subject, validUntil, tier, credId) {
  const message = { subject, tier, jurisdiction: 356, validUntil: BigInt(validUntil), credId };
  return W.ATTESTER.client.signTypedData({
    domain: typedDomain,
    types: { Eligibility: [
      { name: "subject", type: "address" }, { name: "tier", type: "uint8" }, { name: "jurisdiction", type: "uint16" },
      { name: "validUntil", type: "uint64" }, { name: "credId", type: "bytes32" }] },
    primaryType: "Eligibility", message,
  }).then((signature) => ({ message, signature }));
}
async function registerCredential(label, role, validUntil, credId) {
  const subject = W[role].account.address;
  const { message, signature } = await signCredential(subject, validUntil, 2, credId);
  const { hash } = await sendOk(`register credential ${label}`, role, A.attesters.address, A.attesters.abi, "register", [message, signature]);
  return hash;
}
const eligibility = (addr) => publicClient.readContract({ ...A.attesters, functionName: "eligibility", args: [addr] });
const REASON = ["Eligible", "NoCredential", "Expired", "Revoked", "AttesterRemoved"];

function liveInvoice(tag, rupees) {
  const docNo = `L${Math.floor(Date.now() / 1000)}${tag}`.slice(0, 16);
  const f = {
    SellerGstin: SELLER_GSTIN, BuyerGstin: "29DEMOB5678C1Z2", DocNo: docNo, DocTyp: "INV", DocDt: "05/11/2026",
    TotInvVal: rupees, ItemCnt: 1, MainHsnCode: "010190",
  };
  f.Irn = irnFor({ sellerGstin: f.SellerGstin, docNo: f.DocNo, docDt: f.DocDt, docTyp: f.DocTyp });
  f.IrnDt = "2026-11-05 21:00:00";
  const pem = readFileSync(join(root, "contracts/test/fixtures/demo-irp/demo-irp.private.pem"), "utf8");
  return { token: signToken(pem, f), docNo, irn: f.Irn };
}

// ====================================================================================================
console.log(`AttesterRegistry ${A.attesters.address}\nKhataRegistry    ${A.registry.address}\nKhataFactory     ${A.factory.address}`);
const coolOff = Number(await publicClient.readContract({ ...A.registry, functionName: "coolOff" }));
assert.equal(coolOff, s2.coolOffSeconds);
ok("system is deployed and wired", `cool-off ${coolOff}s (live demo value; unit tests cover 24 h)`);

// ---- 0. seller wallet binding (anti QR squatting) ----
import { keccak256, toHex } from "viem";
async function ensureSeller(gstin) {
  const gstinHash = keccak256(toHex(gstin));
  const [wallet0, validUntil0, version0] = await publicClient.readContract({ ...A.registry, functionName: "sellers", args: [gstinHash] });
  const now = await chainNow();
  if (getAddress(wallet0) !== W.SUPPLIER.account.address || Number(validUntil0) < now + 3600) {
    const message = { gstinHash, wallet: W.SUPPLIER.account.address, validUntil: BigInt(now + 7 * 86400), version: BigInt(version0) + 1n };
    const sig = await W.ATTESTER.client.signTypedData({
      domain: typedDomain,
      types: { SellerBinding: [
        { name: "gstinHash", type: "bytes32" }, { name: "wallet", type: "address" },
        { name: "validUntil", type: "uint64" }, { name: "version", type: "uint64" }] },
      primaryType: "SellerBinding", message,
    });
    const { hash } = await sendOk(`register seller wallet ${gstin}`, "INVESTOR", A.registry.address, A.registry.abi, "registerSeller", [message, sig]);
    ok(`attester-signed seller binding registered for ${gstin}`, `tx ${link(hash)}`);
  } else ok(`seller binding for ${gstin} already in place`);
  const [w1] = await publicClient.readContract({ ...A.registry, functionName: "sellers", args: [gstinHash] });
  assert.equal(getAddress(w1), W.SUPPLIER.account.address);
}
await ensureSeller(SELLER_GSTIN);
await ensureSeller("37ARZPT4384Q1MT"); // seller of NIC's published sample invoice (labelled demo wallet for the demo)

// ---- 0b. the real NIC sample, the demo-key namespace, tamper and other refusals ----
{
  const fx = (p) => readFileSync(join(root, "contracts/test/fixtures", p), "utf8").trim();
  const sample = fx("nic-sample.token");
  const collide = fx("redteam/collide-nic-irn.token");
  const regCall = (fn, args) => publicClient.readContract({ ...A.registry, functionName: fn, args });

  // a demo-key token carrying the NIC sample's IRN must not burn the real invoice
  const c = await regCall("inspect", [collide]);
  assert.equal(c.keyIsDemo, true);
  if (!c.alreadyBound) await sendOk("bind demo-key token carrying the NIC IRN", "SUPPLIER", A.registry.address, A.registry.abi, "bindInvoice", [collide]);
  const real = await regCall("inspect", [sample]);
  assert.equal(real.signatureValid, true, "NIC's own signature verifies on-chain");
  assert.equal(real.keyIsDemo, false);
  assert.equal(real.invoice.docNo, "Test-00df1");
  assert.notEqual(real.nullifier, c.nullifier, "demo and government nullifiers are separate");
  ok("NIC's sample signature verifies on-chain against NIC's key (eth_call)", `IRN ${real.invoice.irn}`);

  await expectRevert("a QR holder who is not the seller wallet binds the NIC sample", "INVESTOR", A.registry.address, A.registry.abi, "bindInvoice", [sample], "NotSellerWallet");
  if (!real.alreadyBound) {
    const { hash } = await sendOk("bind NIC sample", "SUPPLIER", A.registry.address, A.registry.abi, "bindInvoice", [sample]);
    ok("NIC sample bound by the seller wallet", `tx ${link(hash)}`);
  }
  await expectRevert("rescan of the NIC sample as a second financier", "SUPPLIER", A.registry.address, A.registry.abi, "bindInvoice", [sample], "IrnAlreadyFinanced");

  const parts = sample.split(".");
  const flipped = parts[1].slice(0, 40) + (parts[1][40] === "A" ? "B" : "A") + parts[1].slice(41);
  await expectRevert("NIC sample with one byte changed", "SUPPLIER", A.registry.address, A.registry.abi, "bindInvoice", [`${parts[0]}.${flipped}.${parts[2]}`], "InvalidSignature");
  const t = await regCall("inspect", [`${parts[0]}.${flipped}.${parts[2]}`]);
  assert.equal(t.signatureValid, false);
  assert.equal(t.invoice.docNo, "", "unverified data is never shown");
  await expectRevert("padded (non-canonical) signature text", "SUPPLIER", A.registry.address, A.registry.abi, "bindInvoice", [`${sample}==`], "MalformedToken", false);
  await expectRevert("token signed under an unregistered kid", "SUPPLIER", A.registry.address, A.registry.abi, "bindInvoice", [fx("demo-irp/demo-unknown-kid.token")], "UnknownKey", false);
  await expectRevert("credit note", "SUPPLIER", A.registry.address, A.registry.abi, "bindInvoice", [fx("demo-irp/demo-credit-note.token")], "InvalidField", false);
}

// ---- credentials: investor (long), investor2 (short, expires mid-hold) ----
const T_START = await chainNow();
const investor2Expiry = T_START + coolOff + 130;
await ensureUsdt(W.INVESTOR.account.address, parseUnits("3.5", 6));
await ensureUsdt(W.INVESTOR2.account.address, parseUnits("1", 6));
await ensureUsdt(W.DEBTOR.account.address, parseUnits("4.2", 6));
const run = String(Date.now());
await registerCredential("investor", "INVESTOR", T_START + 14 * 86400, freshId());
const cred2 = freshId();
await registerCredential("investor2 (short)", "INVESTOR2", investor2Expiry, cred2);
assert.equal(REASON[(await eligibility(W.INVESTOR.account.address))[0]], "Eligible");
assert.equal(REASON[(await eligibility(W.INVESTOR2.account.address))[0]], "Eligible");
assert.notEqual(REASON[(await eligibility(W.DEBTOR.account.address))[0]], "Eligible", "the debtor wallet starts without a valid credential (a previous run may have revoked one)");
ok("credentials registered on-chain and read back as Eligible");

// ---- 1. QR squatting: a holder of the QR who is not the seller wallet cannot bind ----
const inv1 = liveInvoice("A", 42000);
await expectRevert("rival (not the seller wallet) tries to bind the QR", "INVESTOR", A.registry.address, A.registry.abi, "bindInvoice", [inv1.token], "NotSellerWallet");

// ---- 2. seller binds; a second bind is refused ----
const bound = await sendOk("bind invoice", "SUPPLIER", A.registry.address, A.registry.abi, "bindInvoice", [inv1.token]);
const insp = await publicClient.readContract({ ...A.registry, functionName: "inspect", args: [inv1.token] });
assert.equal(insp.signatureValid, true);
assert.equal(insp.alreadyBound, true);
assert.equal(insp.keyIsDemo, true);
const nullifier = insp.nullifier;
const [binder, boundAt, valuePaise, , fundableAt] = await publicClient.readContract({ ...A.registry, functionName: "bindings", args: [nullifier] });
assert.equal(getAddress(binder), W.SUPPLIER.account.address);
assert.equal(valuePaise, 4_200_000n);
assert.equal(Number(fundableAt), Number(boundAt) + coolOff);
ok("invoice bound by the seller wallet and read back", `tx ${link(bound.hash)} value ₹${Number(valuePaise) / 100} fundableAt=boundAt+${coolOff}s`);
await expectRevert("second financing of the same invoice", "SUPPLIER", A.registry.address, A.registry.abi, "bindInvoice", [inv1.token], "IrnAlreadyFinanced");

// ---- 3. note ----
const T0 = Number(boundAt);
const dueDate = BigInt(T0 + coolOff + 160);
const fundingDeadline = BigInt(T0 + coolOff + 120);
const terms = { dueDate, fundingDeadline, graceSeconds: 20n, discountBps: 500, minTier: 1 };
const created = await sendOk("create note", "SUPPLIER", A.factory.address, A.factory.abi, "createNote", [nullifier, terms]);
const noteAddr = await publicClient.readContract({ ...A.factory, functionName: "noteOf", args: [nullifier] });
const note = { address: noteAddr, abi: noteAbi };
const nread = (fn, args = []) => publicClient.readContract({ ...note, functionName: fn, args });
const FACE = 4_200_000n;
assert.equal(await nread("faceValue"), FACE);
assert.equal(await nread("decimals"), 6);
assert.equal(await nread("balanceOf", [noteAddr]), FACE);
assert.equal(getAddress(await nread("seller")), W.SUPPLIER.account.address);
ok("note created, 4.2 USDT face value held in escrow", `note ${noteAddr} tx ${link(created.hash)}`);

// ---- 4. cool-off: funding is refused until fundableAt ----
const approveMax = async (role, amount) => sendOk(`approve ${role}`, role, USDT, usdtAbi, "approve", [noteAddr, amount]);
await approveMax("INVESTOR", parseUnits("3.0", 6));
// this check must run, not be skipped: if the steps above took longer than the cool-off, fail and say so
assert.ok((await chainNow()) < Number(fundableAt), "the cool-off ended before it could be checked; the RPC was too slow for this run");
await expectRevert("funding inside the cool-off", "INVESTOR", noteAddr, noteAbi, "fund", [3_000_000n], "CoolOffActive");
await waitUntil(Number(fundableAt), "cool-off over");

// ---- 5. atomic delivery-versus-payment with the real USDT ----
{
  const price = await nread("quote", [3_000_000n]);
  assert.equal(price, 2_850_000n);
  const sellerBefore = await bal(W.SUPPLIER.account.address);
  const invBefore = await bal(W.INVESTOR.account.address);
  const { hash } = await sendOk("fund 3.0 USDT of notes", "INVESTOR", noteAddr, noteAbi, "fund", [3_000_000n]);
  assert.equal((await bal(W.SUPPLIER.account.address)) - sellerBefore, price, "seller is paid at once");
  assert.equal(invBefore - (await bal(W.INVESTOR.account.address)), price);
  assert.equal(await nread("balanceOf", [W.INVESTOR.account.address]), 3_000_000n);
  assert.equal(await bal(noteAddr), 0n, "the note never holds the payment");
  ok(`investor paid ${u(price)} USDT of real prize USDT and received 3.0 notes in one transaction`, `tx ${link(hash)}`);
}

// ---- 6. permit path: discover the real USDT's EIP-2612 domain, then fund with a signature ----
{
  const onchain = await publicClient.readContract({ address: USDT, abi: usdtAbi, functionName: "DOMAIN_SEPARATOR" });
  let domain;
  for (const name of ["Tether USD", "USDT", "USD₮0", "Tether USD₮0"]) {
    for (const version of ["1", "2", "3", "4"]) {
      const d = { name, version, chainId: 1874, verifyingContract: USDT };
      if (domainSeparator({ domain: d }) === onchain) domain = d;
    }
  }
  if (!domain) {
    assert.fail("could not match the USDT permit domain, so the permit path cannot be tested (the token's domain changed?)");
  } else {
    const amount = 600_000n;
    const price = await nread("quote", [amount]);
    const deadline = BigInt((await chainNow()) + 600);
    const nonce = await publicClient.readContract({ address: USDT, abi: usdtAbi, functionName: "nonces", args: [W.INVESTOR2.account.address] });
    const sig = await W.INVESTOR2.client.signTypedData({
      domain,
      types: { Permit: [
        { name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
      primaryType: "Permit",
      message: { owner: W.INVESTOR2.account.address, spender: noteAddr, value: price, nonce, deadline },
    });
    const { v, r, s } = hexToSignature(sig);
    const { hash } = await sendOk("fund with permit", "INVESTOR2", noteAddr, noteAbi, "fundWithPermit", [amount, deadline, Number(v), r, s]);
    assert.equal(await nread("balanceOf", [W.INVESTOR2.account.address]), amount);
    ok(`investor2 funded 0.6 notes with a USDT permit signature (domain "${domain.name}" v${domain.version}), no approval transaction`, `tx ${link(hash)}`);
  }
}

// ---- 7. transfer rules, each a real on-chain refusal ----
const debtorAddr = W.DEBTOR.account.address;
// a fresh address that has never had a credential, so the "no credential" case is the same on every run
const outsider = privateKeyToAccount(generatePrivateKey()).address;
{
  const [okFlag, why] = await nread("explainTransfer", [W.INVESTOR.account.address, outsider, 100_000n]);
  assert.equal(okFlag, false);
  assert.equal(why, "The receiver has no credential from an accepted attester.");
  const r = await expectRevert("transfer to a wallet with no credential", "INVESTOR", noteAddr, noteAbi, "transfer", [outsider, 100_000n], "ReceiverNotEligible");
  assert.equal(REASON[r.args[1]], "NoCredential");
  ok(`readable reason: "${why}"`);
  assert.equal(await nread("balanceOf", [outsider]), 0n, "nothing moved");
}
{
  const { hash } = await sendOk("transfer to an eligible holder", "INVESTOR", noteAddr, noteAbi, "transfer", [W.INVESTOR2.account.address, 100_000n]);
  assert.equal(await nread("balanceOf", [W.INVESTOR2.account.address]), 700_000n);
  ok("transfer to a holder with a valid credential succeeds", `tx ${link(hash)}`);
}
{
  // give the debtor a credential, then revoke it: the rule reacts to the revocation
  const credD = freshId();
  await registerCredential("debtor", "DEBTOR", T_START + 14 * 86400, credD);
  await sendOk("transfer to debtor while credentialed", "INVESTOR", noteAddr, noteAbi, "transfer", [debtorAddr, 50_000n]);
  const rv = { credId: credD };
  const revSig = await W.ATTESTER.client.signTypedData({
    domain: typedDomain, types: { Revocation: [{ name: "credId", type: "bytes32" }] }, primaryType: "Revocation", message: rv,
  });
  const { hash } = await sendOk("revoke debtor credential", "SUPPLIER", A.attesters.address, A.attesters.abi, "revoke", [rv, revSig]);
  assert.equal(REASON[(await eligibility(debtorAddr))[0]], "Revoked");
  ok("attester-signed revocation submitted by a third party", `tx ${link(hash)}`);
  const r = await expectRevert("transfer after the receiver's credential was revoked", "INVESTOR", noteAddr, noteAbi, "transfer", [debtorAddr, 50_000n], "ReceiverNotEligible");
  assert.equal(REASON[r.args[1]], "Revoked");
}
{
  // investor2's short credential expires; the holder keeps the notes but can no longer receive
  await waitUntil(investor2Expiry, "investor2's credential expires");
  assert.equal(REASON[(await eligibility(W.INVESTOR2.account.address))[0]], "Expired");
  const r = await expectRevert("transfer to a holder whose credential expired", "INVESTOR", noteAddr, noteAbi, "transfer", [W.INVESTOR2.account.address, 10_000n], "ReceiverNotEligible");
  assert.equal(REASON[r.args[1]], "Expired");
  assert.equal(await nread("balanceOf", [W.INVESTOR2.account.address]), 700_000n, "investor2 keeps what they hold");
  ok("credential expiry reacted: the rule blocked a transfer that was allowed a minute earlier");
}

// ---- 8. unsold notes, settlement ----
await expectRevert("settle before the due date", "DEBTOR", noteAddr, noteAbi, "settle", [], "NotYetDue", false);
await waitUntil(Number(fundingDeadline), "funding deadline passed");
{
  const { hash } = await sendOk("close funding (anyone, after the deadline)", "DEBTOR", noteAddr, noteAbi, "closeFunding", []);
  assert.equal(await nread("totalSupply"), 3_600_000n, "3.0 + 0.6 funded; the unsold 0.6 was burned");
  ok("unsold notes burned after the funding deadline", `tx ${link(hash)} supply now ${u(await nread("totalSupply"))}`);
}
await waitUntil(Number(dueDate) - 1, "due date");
await expectRevert("transfer at maturity", "INVESTOR", noteAddr, noteAbi, "transfer", [W.INVESTOR2.account.address, 1n], "TransferAfterMaturity");
await ensureUsdt(debtorAddr, FACE);
await sendOk("debtor approves face value", "DEBTOR", USDT, usdtAbi, "approve", [noteAddr, FACE]);
{
  const sellerBefore = await bal(W.SUPPLIER.account.address);
  const supply = await nread("totalSupply");
  const { hash } = await sendOk("settle", "DEBTOR", noteAddr, noteAbi, "settle", []);
  assert.equal(await nread("phase"), 1);
  const residual = FACE - supply;
  assert.equal((await bal(W.SUPPLIER.account.address)) - sellerBefore, residual, "seller keeps the unsold share");
  assert.equal(await bal(noteAddr), supply, "the note holds exactly what holders are owed");
  ok(`debtor paid the full 4.2 USDT; seller received the unsold ${u(residual)}; holders are owed ${u(supply)}`, `tx ${link(hash)}`);
}
await expectRevert("settle twice", "DEBTOR", noteAddr, noteAbi, "settle", [], "WrongPhase", false);

// ---- 9. redeem ----
{
  const inv1Notes = await nread("balanceOf", [W.INVESTOR.account.address]);
  const before = await bal(W.INVESTOR.account.address);
  const { hash } = await sendOk("investor redeems", "INVESTOR", noteAddr, noteAbi, "redeem", []);
  assert.equal((await bal(W.INVESTOR.account.address)) - before, inv1Notes);
  assert.equal(await nread("balanceOf", [W.INVESTOR.account.address]), 0n);
  ok(`investor redeemed ${u(inv1Notes)} notes for ${u(inv1Notes)} USDT`, `tx ${link(hash)}`);
  await expectRevert("redeem twice", "INVESTOR", noteAddr, noteAbi, "redeem", [], "NothingToRedeem", false);
  // investor2's credential is expired, yet redemption still works
  const n2 = await nread("balanceOf", [W.INVESTOR2.account.address]);
  const b2 = await bal(W.INVESTOR2.account.address);
  await sendOk("investor2 redeems with an expired credential", "INVESTOR2", noteAddr, noteAbi, "redeem", []);
  assert.equal((await bal(W.INVESTOR2.account.address)) - b2, n2);
  ok("a holder with an expired credential still redeems in full");
  // the debtor wallet holds the 0.05 it received while credentialed; its credential was revoked, redemption still works
  const nd = await nread("balanceOf", [debtorAddr]);
  assert.equal(nd, 50_000n);
  const bd = await bal(debtorAddr);
  await sendOk("a wallet with a revoked credential redeems", "DEBTOR", noteAddr, noteAbi, "redeem", []);
  assert.equal((await bal(debtorAddr)) - bd, nd);
}
{
  assert.equal(await nread("totalSupply"), 0n, "every note was redeemed");
  assert.equal(await bal(noteAddr), 0n, "and the note holds no USDT: nothing paid twice, no dust");
  ok("conservation: all notes redeemed, the contract holds 0 USDT");
}

// ---- 10. default on a second invoice ----
{
  const inv2 = liveInvoice("B", 42000);
  await sendOk("bind second invoice", "SUPPLIER", A.registry.address, A.registry.abi, "bindInvoice", [inv2.token]);
  const ins = await publicClient.readContract({ ...A.registry, functionName: "inspect", args: [inv2.token] });
  const [, at2] = await publicClient.readContract({ ...A.registry, functionName: "bindings", args: [ins.nullifier] });
  const due2 = BigInt(Number(at2) + coolOff + 40);
  const terms2 = { dueDate: due2, fundingDeadline: due2 - 10n, graceSeconds: 10n, discountBps: 300, minTier: 1 };
  await sendOk("create note 2", "SUPPLIER", A.factory.address, A.factory.abi, "createNote", [ins.nullifier, terms2]);
  const addr2 = await publicClient.readContract({ ...A.factory, functionName: "noteOf", args: [ins.nullifier] });
  await waitUntil(Number(at2) + coolOff, "cool-off of note 2");
  await sendOk("approve note 2", "INVESTOR", USDT, usdtAbi, "approve", [addr2, parseUnits("1", 6)]);
  await sendOk("fund note 2", "INVESTOR", addr2, noteAbi, "fund", [1_000_000n]);
  await expectRevert("mark default too early", "DEBTOR", addr2, noteAbi, "markDefault", [], "NotInDefault", false);
  await waitUntil(Number(due2) + 10, "due date plus grace");
  const { hash } = await sendOk("mark default", "DEBTOR", addr2, noteAbi, "markDefault", []);
  assert.equal(await publicClient.readContract({ address: addr2, abi: noteAbi, functionName: "phase" }), 2);
  assert.equal(await publicClient.readContract({ address: addr2, abi: noteAbi, functionName: "totalSupply" }), 1_000_000n, "unsold notes burned");
  ok("default marked after due date plus grace (anyone may call)", `tx ${link(hash)}`);
  await expectRevert("settle after default", "DEBTOR", addr2, noteAbi, "settle", [], "WrongPhase", false);
  await expectRevert("redeem after default", "INVESTOR", addr2, noteAbi, "redeem", [], "WrongPhase", false);
  assert.equal(await bal(addr2), 0n, "nothing is paid out on default");
  ok("after default nothing can be settled or redeemed, and the note holds no USDT");
}
console.log(`\n${checks} live checks passed`);
writeFileSync(join(root, "logs/live-stage2-txs.json"), JSON.stringify(txs, null, 2));
// The same transactions, kept in the repo so the app's evidence page and the README can link every one of them.
{
  const file = join(root, "deployments/evidence.json");
  let old; try { old = JSON.parse(readFileSync(file, "utf8")); } catch { old = undefined; }
  const header = { chainId: dep.chainId, KhataRegistry: s2.KhataRegistry, KhataFactory: s2.KhataFactory, generatedBy: "npm run live:stage2 (merged across runs)" };
  writeFileSync(file, JSON.stringify(mergeEvidence(old, header, txs), null, 2) + "\n");
}
