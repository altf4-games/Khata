// The hosted app never holds a demo wallet key in the browser. A server function signs for it, within a narrow policy.
// These tests run the same policy code the function uses, with a throwaway key made here (never a real one).
import { expect, test } from "@playwright/test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { encodeFunctionData, parseAbi, parseTransaction, recoverTransactionAddress, recoverTypedDataAddress, type Hex } from "viem";
import { handleSign } from "../../api/_signer";
import { wire } from "../../api/_wire";
import deployment from "../../deployments/whitechain-sepolia.json" with { type: "json" };

const key = generatePrivateKey();
const me = privateKeyToAccount(key);
const env = { DEMO_SUPPLIER_KEY: key };
const st = deployment.stage2;
const erc20 = parseAbi(["function transfer(address,uint256)", "function transferFrom(address,address,uint256)", "function approve(address,uint256)"]);
const base = { type: "eip1559", chainId: 1874, nonce: 1, gas: 200_000n, maxFeePerGas: 6_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n, value: 0n } as const;
const NOTE = "0x1111111111111111111111111111111111111111";
const deps = { isNote: async (a: string) => a.toLowerCase() === NOTE };
const sign = (tx: object, wallet = "supplier", e: Record<string, string | undefined> = env) => handleSign(wire.encode({ wallet, kind: "transaction", tx }), e, deps);
const typed = (domain: object, kind = "typedData") =>
  handleSign(wire.encode({ wallet: "supplier", kind, typedData: { domain, types: { Ping: [{ name: "n", type: "uint256" }] }, primaryType: "Ping", message: { n: 1n } } }), env, deps);

test("signs an ordinary contract call on Whitechain, and the signature recovers to the wallet", async () => {
  const data = encodeFunctionData({ abi: erc20, functionName: "approve", args: [st.KhataFactory as Hex, 5n] });
  const r = await sign({ ...base, to: st.usdt, data });
  expect(r.status).toBe(200);
  expect(await recoverTransactionAddress({ serializedTransaction: r.body.signed })).toBe(me.address);
  expect(parseTransaction(r.body.signed).chainId).toBe(1874);
});

test("signs an Arkiv write on the Arkiv testnet", async () => {
  const r = await sign({ ...base, chainId: 7794095, to: "0x00000000000000000000000000000061726b6976", data: "0x1234" });
  expect(r.status).toBe(200);
});

test("signs an Arkiv write to the entity registry the SDK uses on Rabdi, and nothing else on that chain", async () => {
  expect((await sign({ ...base, chainId: 7794095, to: "0x4400000000000000000000000000000000000044", data: "0x1234" })).status).toBe(200);
  expect((await sign({ ...base, chainId: 7794095, to: "0x000000000000000000000000000000000000dEaD", data: "0x1234" })).status).toBe(403);
});

test("refuses to move native funds out of a demo wallet", async () => {
  const r = await sign({ ...base, to: "0x000000000000000000000000000000000000dEaD", value: 1n });
  expect(r.status).toBe(403);
  expect(r.body.error).toMatch(/native/i);
});

test("refuses a direct USDT transfer or transferFrom, which would move real tokens out", async () => {
  for (const [fn, args] of [["transfer", [me.address, 1n]], ["transferFrom", [me.address, me.address, 1n]]] as const) {
    const data = encodeFunctionData({ abi: erc20, functionName: fn, args } as never);
    const r = await sign({ ...base, to: st.usdt, data });
    expect(r.status, fn).toBe(403);
    expect(r.body.error).toMatch(/USDT/);
  }
});

test("refuses other chains and contract creation", async () => {
  expect((await sign({ ...base, chainId: 1, to: st.usdt, data: "0x" })).status).toBe(403);
  expect((await sign({ ...base, data: "0x6080" })).status).toBe(403);
});

test("refuses a wallet it does not know, and one with no key configured", async () => {
  expect((await sign({ ...base, to: st.usdt, data: "0x" }, "mallory")).status).toBe(404);
  expect((await sign({ ...base, to: st.usdt, data: "0x" }, "debtor")).status).toBe(503);
});

const permitTypes = { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] };
const attDomain = { name: "KhataAttesters", version: "1", chainId: 1874, verifyingContract: st.AttesterRegistry as Hex };
const usdtDomain = { name: "Tether USD", version: "1", chainId: 1874, verifyingContract: st.usdt as Hex };
const soon = () => BigInt(Math.floor(Date.now() / 1000) + 600);
const signTyped = (wallet: string, domain: object, types: object, primaryType: string, message: object) =>
  handleSign(wire.encode({ wallet, kind: "typedData", typedData: { domain, types, primaryType, message } }), { ...env, DEMO_ATTESTER_KEY: key, DEMO_INVESTOR_KEY: key }, deps);
const wallets = Object.fromEntries((await import("../../deployments/demo-wallets.json", { with: { type: "json" } })).default.map((w: any) => [w.id, w.address]));
const eligibility = [{ name: "subject", type: "address" }, { name: "tier", type: "uint8" }, { name: "jurisdiction", type: "uint16" }, { name: "validUntil", type: "uint64" }, { name: "credId", type: "bytes32" }];
const binding = [{ name: "gstinHash", type: "bytes32" }, { name: "wallet", type: "address" }, { name: "validUntil", type: "uint64" }, { name: "version", type: "uint64" }];
const credId = ("0x" + "ab".repeat(32)) as Hex;

test("signs a USDT permit only from the wallet itself, to a real note, with a bounded value and deadline", async () => {
  const msg = { owner: me.address, spender: NOTE, value: 5_000_000n, nonce: 0n, deadline: soon() };
  const ok = await signTyped("investor", usdtDomain, permitTypes, "Permit", msg);
  expect(ok.status).toBe(200);
  expect(await recoverTypedDataAddress({ domain: usdtDomain, types: permitTypes, primaryType: "Permit", message: msg, signature: ok.body.signed! })).toBe(me.address);
  for (const bad of [
    { ...msg, spender: "0x000000000000000000000000000000000000dEaD" },
    { ...msg, value: 2n ** 256n - 1n },
    { ...msg, deadline: 2n ** 255n },
    { ...msg, owner: "0x000000000000000000000000000000000000dEaD" },
  ]) expect((await signTyped("investor", usdtDomain, permitTypes, "Permit", bad)).status).toBe(403);
});

test("refuses typed data on any other domain, or any other structure on the USDT domain", async () => {
  expect((await typed({ name: "Evil", version: "1", chainId: 1874, verifyingContract: "0x000000000000000000000000000000000000dEaD" })).status).toBe(403);
  expect((await typed({ ...usdtDomain, chainId: 1 })).status).toBe(403);
  expect((await typed(usdtDomain)).status).toBe(403); // a Ping struct on the USDT domain
});

test("the attester signs only bounded credentials for the demo wallets, never for a stranger", async () => {
  const until = soon();
  const good = { subject: wallets.investor, tier: 2, jurisdiction: 356, validUntil: until, credId };
  expect((await signTyped("attester", attDomain, { Eligibility: eligibility }, "Eligibility", good)).status).toBe(200);
  for (const bad of [
    { ...good, subject: "0x000000000000000000000000000000000000dEaD" },
    { ...good, tier: 255 },
    { ...good, validUntil: 2n ** 60n },
  ]) expect((await signTyped("attester", attDomain, { Eligibility: eligibility }, "Eligibility", bad)).status).toBe(403);
  // only the attester wallet may sign on the registry's domain
  expect((await signTyped("investor", attDomain, { Eligibility: eligibility }, "Eligibility", good)).status).toBe(403);
});

test("a seller binding may only point at a demo wallet, with a bounded version", async () => {
  const good = { gstinHash: credId, wallet: wallets.supplier, validUntil: soon(), version: 7n };
  expect((await signTyped("attester", attDomain, { SellerBinding: binding }, "SellerBinding", good)).status).toBe(200);
  for (const bad of [{ ...good, wallet: "0x000000000000000000000000000000000000dEaD" }, { ...good, version: 2n ** 64n - 1n }, { ...good, validUntil: 2n ** 60n }])
    expect((await signTyped("attester", attDomain, { SellerBinding: binding }, "SellerBinding", bad)).status).toBe(403);
});

test("refuses an unlimited USDT approval to a stranger and any call to an unknown contract", async () => {
  const evil = "0x000000000000000000000000000000000000dEaD";
  const approveEvil = encodeFunctionData({ abi: erc20, functionName: "approve", args: [evil, 2n ** 256n - 1n] });
  expect((await sign({ ...base, to: st.usdt, data: approveEvil })).status).toBe(403);
  const approveNote = encodeFunctionData({ abi: erc20, functionName: "approve", args: [NOTE, 5n] });
  expect((await sign({ ...base, to: st.usdt, data: approveNote })).status).toBe(200);
  expect((await sign({ ...base, to: evil, data: "0x12345678" })).status).toBe(403);
  // a note may be called, but not asked to approve a stranger for its shares
  expect((await sign({ ...base, to: NOTE, data: encodeFunctionData({ abi: parseAbi(["function fund(uint256)"]), functionName: "fund", args: [1n] }) })).status).toBe(200);
  expect((await sign({ ...base, to: NOTE, data: approveEvil })).status).toBe(403);
});

test("refuses a transaction whose worst-case gas cost is large", async () => {
  expect((await sign({ ...base, to: st.KhataRegistry, data: "0x", maxFeePerGas: 10n ** 20n })).status).toBe(403);
  expect((await sign({ ...base, to: st.KhataRegistry, data: "0x", gas: 50_000_000n })).status).toBe(403);
});

test("a malformed number in a request is a 400, not a crash", async () => {
  const r = await sign({ ...base, to: st.KhataRegistry, data: "0x", value: "abc" });
  expect(r.status).toBe(400);
});

test("never signs a raw message, and rejects malformed requests", async () => {
  expect((await handleSign(wire.encode({ wallet: "supplier", kind: "message", message: "hi" }), env, deps)).status).toBe(400);
  expect((await handleSign("nonsense", env, deps)).status).toBe(400);
  expect((await handleSign(wire.encode({ wallet: "supplier", kind: "transaction" }), env, deps)).status).toBe(400);
});

// ---- second red-team pass ----
import { makeLiveDeps, RateLimiter } from "../../api/_signer";
import registryAbi from "../../web/src/registry-abi.json" with { type: "json" };
import factoryAbi from "../../web/src/factory-abi.json" with { type: "json" };
import attestersAbi from "../../web/src/attesters-abi.json" with { type: "json" };
import { toFunctionSelector } from "viem";

const selOf = (abi: any, name: string) => toFunctionSelector(abi.find((i: any) => i.type === "function" && i.name === name));
const call = (to: string, abi: any, name: string) => sign({ ...base, to, data: (selOf(abi, name) + "00".repeat(64)) as Hex });

test("the project contracts can be called only through the functions the app uses", async () => {
  for (const [to, abi, name] of [[st.KhataRegistry, registryAbi, "bindInvoice"], [st.KhataRegistry, registryAbi, "bindInvoiceZk"], [st.KhataRegistry, registryAbi, "registerSeller"], [st.KhataFactory, factoryAbi, "createNote"], [st.AttesterRegistry, attestersAbi, "register"], [st.AttesterRegistry, attestersAbi, "revoke"]] as const)
    expect((await call(to, abi, name)).status, name).toBe(200);
  for (const [to, abi, name] of [[st.KhataRegistry, registryAbi, "addKey"], [st.KhataRegistry, registryAbi, "setZkVerifier"], [st.KhataRegistry, registryAbi, "retireKey"], [st.KhataRegistry, registryAbi, "transferOwnership"], [st.AttesterRegistry, attestersAbi, "addAttester"], [st.AttesterRegistry, attestersAbi, "removeAttester"], [st.AttesterRegistry, attestersAbi, "acceptOwnership"]] as const)
    expect((await call(to, abi, name)).status, name).toBe(403);
  expect((await sign({ ...base, to: st.KhataRegistry, data: "0x" })).status).toBe(403);
});

const eligibilityTypes = { Eligibility: [{ name: "subject", type: "address" }, { name: "tier", type: "uint8" }, { name: "jurisdiction", type: "uint16" }, { name: "validUntil", type: "uint64" }, { name: "credId", type: "bytes32" }] };
const attester = (types: object, primaryType: string, message: object) => signTyped("attester", attDomain, types, primaryType, message);
const goodEl = () => ({ subject: wallets.investor, tier: 2, jurisdiction: 356, validUntil: soon(), credId });

test("typed data must have exactly the structure the contract hashes, with exactly its fields", async () => {
  expect((await attester(eligibilityTypes, "Eligibility", goodEl())).status).toBe(200);
  // an extra field in the declared types
  expect((await attester({ Eligibility: [...eligibilityTypes.Eligibility, { name: "extra", type: "uint256" }] }, "Eligibility", { ...goodEl(), extra: 1n })).status).toBe(403);
  // an extra message key
  expect((await attester(eligibilityTypes, "Eligibility", { ...goodEl(), extra: 1 })).status).toBe(403);
  // a missing message key
  const { credId: _c, ...missing } = goodEl();
  expect((await attester(eligibilityTypes, "Eligibility", missing)).status).toBe(403);
  // reordered fields
  expect((await attester({ Eligibility: [...eligibilityTypes.Eligibility].reverse() }, "Eligibility", goodEl())).status).toBe(403);
});

test("odd numbers are refused, not signed", async () => {
  for (const bad of [{ tier: "NaN" }, { tier: -1 }, { tier: 1.5 }, { tier: "0x2" }, { validUntil: -5n }])
    expect((await attester(eligibilityTypes, "Eligibility", { ...goodEl(), ...bad })).status, JSON.stringify(bad, (_k, v) => (typeof v === "bigint" ? String(v) : v))).toBeGreaterThanOrEqual(400);
  const approve = encodeFunctionData({ abi: erc20, functionName: "approve", args: [NOTE, 5n] });
  for (const bad of [{ gas: -1n }, { maxFeePerGas: -1n }, { chainId: "0x752" }, { value: [] as never }])
    expect((await sign({ ...base, to: st.usdt, data: approve, ...bad })).status, JSON.stringify(bad, (_k, v) => (typeof v === "bigint" ? String(v) : v))).toBeGreaterThanOrEqual(400);
});

test("an oversized request is refused before anything is read", async () => {
  const r = await sign({ ...base, to: st.KhataRegistry, data: ("0x" + "ab".repeat(200_000)) as Hex });
  expect(r.status).toBe(413);
});

test("an unknown contract is looked up once, and a malformed address is never looked up", async () => {
  let reads = 0;
  const live = makeLiveDeps(async () => { reads++; return false; });
  for (let i = 0; i < 1000; i++) expect(await live.isNote("0x2222222222222222222222222222222222222222")).toBe(false);
  expect(reads).toBe(1);
  expect(await live.isNote("not-an-address")).toBe(false);
  expect(await live.isNote("0x12")).toBe(false);
  expect(reads).toBe(1);
});

test("a caller is limited to a number of signatures a minute, and the limit is per caller", () => {
  const rl = new RateLimiter({ perCaller: 3, total: 100, windowMs: 60_000 });
  const t = 1_000_000;
  expect([rl.allow("a", t), rl.allow("a", t), rl.allow("a", t), rl.allow("a", t)]).toEqual([true, true, true, false]);
  expect(rl.allow("b", t)).toBe(true);
  expect(rl.allow("a", t + 61_000)).toBe(true); // the window passes
  const tiny = new RateLimiter({ perCaller: 100, total: 2, windowMs: 60_000 });
  expect([tiny.allow("x", t), tiny.allow("y", t), tiny.allow("z", t)]).toEqual([true, true, false]);
});

import { ELIGIBILITY_TYPES, REVOCATION_TYPES, SELLER_BINDING_TYPES } from "../src/eip712";
test("the exact shapes the signer allows are the shapes the app really sends", async () => {
  expect((await attester(ELIGIBILITY_TYPES, "Eligibility", goodEl())).status).toBe(200);
  expect((await attester(REVOCATION_TYPES, "Revocation", { credId })).status).toBe(200);
  expect((await attester(SELLER_BINDING_TYPES, "SellerBinding", { gstinHash: credId, wallet: wallets.supplier, validUntil: soon(), version: 1n })).status).toBe(200);
  expect((await attester(REVOCATION_TYPES, "Revocation", { credId: "0x12" })).status).toBe(403);
});
