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
const sign = (tx: object, wallet = "supplier", e: Record<string, string | undefined> = env) => handleSign(wire.encode({ wallet, kind: "transaction", tx }), e);
const typed = (domain: object, kind = "typedData") =>
  handleSign(wire.encode({ wallet: "supplier", kind, typedData: { domain, types: { Ping: [{ name: "n", type: "uint256" }] }, primaryType: "Ping", message: { n: 1n } } }), env);

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

test("signs typed data only for the USDT permit domain and the attester registry domain", async () => {
  const ok1 = await typed({ name: "Tether USD", version: "1", chainId: 1874, verifyingContract: st.usdt });
  expect(ok1.status).toBe(200);
  const ok2 = await typed({ name: "KhataAttesters", version: "1", chainId: 1874, verifyingContract: st.AttesterRegistry });
  expect(ok2.status).toBe(200);
  expect(await recoverTypedDataAddress({ domain: { name: "KhataAttesters", version: "1", chainId: 1874, verifyingContract: st.AttesterRegistry as Hex }, types: { Ping: [{ name: "n", type: "uint256" }] }, primaryType: "Ping", message: { n: 1n }, signature: ok2.body.signed })).toBe(me.address);
  const bad = await typed({ name: "Evil", version: "1", chainId: 1874, verifyingContract: "0x000000000000000000000000000000000000dEaD" });
  expect(bad.status).toBe(403);
  const wrongChain = await typed({ name: "Tether USD", version: "1", chainId: 1, verifyingContract: st.usdt });
  expect(wrongChain.status).toBe(403);
});

test("never signs a raw message, and rejects malformed requests", async () => {
  expect((await handleSign(wire.encode({ wallet: "supplier", kind: "message", message: "hi" }), env)).status).toBe(400);
  expect((await handleSign("nonsense", env)).status).toBe(400);
  expect((await handleSign(wire.encode({ wallet: "supplier", kind: "transaction" }), env)).status).toBe(400);
});
