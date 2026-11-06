// The browser builds the circuit's inputs itself. They must match what the command-line generator (used for the live proofs
// that the contract accepted) produces for the same token, field for field.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { buildCircuitInput, limbsOf } from "../src/zk-inputs";

const OWNER = "0xDFa97bfe5d2b2E8169b194eAA78Fbb793346B174";
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8").trim();

function cli(token: string, modFile: string, demo: boolean) {
  const dir = "/tmp/khata-zk-inputs-test.toml";
  execFileSync("node", ["zk/scripts/inputs.mjs", token, modFile, String(demo), OWNER, dir], { cwd: new URL("../../", import.meta.url).pathname });
  const t = readFileSync(dir, "utf8");
  const arr = (k: string) => JSON.parse(t.match(new RegExp(`^${k} = (\\[.*\\])`, "m"))![1]);
  const num = (k: string) => String(Number(t.match(new RegExp(`^${k} = (\\d+)`, "m"))![1]));
  return {
    storage: JSON.parse(t.match(/storage = (\[.*\])/)![1]).map(String), len: num("len"), payload_start: num("payload_start"),
    modulus: arr("modulus"), redc: arr("redc"), signature: arr("signature"),
    pos: { gstin: num("gstin"), doctyp: num("doctyp"), value: num("value"), value_len: num("value_len"), irn: num("irn") },
  };
}

for (const [name, token, mod, demo] of [
  ["the NIC sample", "contracts/test/fixtures/nic-sample.token", "contracts/test/fixtures/nic-sample.modulus.hex", false],
  ["a demo invoice", "contracts/test/fixtures/demo-irp/demo-01.token", "contracts/test/fixtures/demo-irp/demo-irp.modulus.hex", true],
] as const) {
  test(`the browser's inputs equal the generator's for ${name}`, () => {
    const want = cli(token, mod, demo);
    const got = buildCircuitInput(read(token), ("0x" + read(mod).replace(/^0x/, "")) as `0x${string}`, OWNER, demo);
    expect(got.data.storage).toEqual(want.storage);
    expect(got.data.len).toBe(want.len);
    expect(got.payload_start).toBe(want.payload_start);
    expect(got.modulus).toEqual(want.modulus);
    expect(got.redc).toEqual(want.redc);
    expect(got.signature).toEqual(want.signature);
    expect(got.pos).toEqual(want.pos);
    expect(got.owner).toBe(String(BigInt(OWNER)));
    expect(got.demo).toBe(demo);
  });
}

test("a signed text longer than the circuit takes is refused with a plain reason", () => {
  const long = read("contracts/test/fixtures/nic-sample.token");
  const [h, p, s] = long.split(".");
  expect(() => buildCircuitInput(`${h}.${p}${"A".repeat(200)}.${s}`, ("0x" + read("contracts/test/fixtures/nic-sample.modulus.hex").replace(/^0x/, "")) as `0x${string}`, OWNER, false)).toThrow(/too long/i);
});

test("limbs are 18 numbers of 120 bits, least significant first", () => {
  const l = limbsOf((1n << 120n) + 5n);
  expect(l.length).toBe(18);
  expect(l[0]).toBe("5");
  expect(l[1]).toBe("1");
});

// Field positions are byte offsets into the decoded payload (what the circuit reads), not JavaScript string indices.
const enc = (o: unknown) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
function tokenWith(dataJson: string) {
  return `${enc({ alg: "RS256", kid: "X" })}.${enc(JSON.stringify({ iss: "NIC", data: dataJson }))}.${Buffer.alloc(256, 1).toString("base64url")}`;
}
const MOD = ("0x" + read("contracts/test/fixtures/demo-irp/demo-irp.modulus.hex").replace(/^0x/, "")) as `0x${string}`;

test("a non-ASCII character before the fields does not shift their positions", () => {
  const data = JSON.stringify({ SellerName: "Śrī Gaṇeśa Traders", SellerGstin: "27DEMOS1234A1Z5", DocTyp: "INV", TotInvVal: 42000, Irn: "ab".repeat(32) });
  const got = buildCircuitInput(tokenWith(data), MOD, OWNER, true);
  const payload = Buffer.from(tokenWith(data).split(".")[1], "base64url");
  const at = (needle: string) => payload.indexOf(Buffer.from(needle)) + Buffer.byteLength(needle);
  expect(got.pos.gstin).toBe(String(at('\\"SellerGstin\\":\\"')));
  expect(got.pos.irn).toBe(String(at('\\"Irn\\":\\"')));
  expect(payload.subarray(Number(got.pos.gstin), Number(got.pos.gstin) + 15).toString()).toBe("27DEMOS1234A1Z5");
});

test("an invoice whose value is the last field is refused with a plain reason, not a negative length", () => {
  const data = JSON.stringify({ SellerGstin: "27DEMOS1234A1Z5", DocTyp: "INV", Irn: "ab".repeat(32), TotInvVal: 42000 });
  expect(() => buildCircuitInput(tokenWith(data), MOD, OWNER, true)).toThrow(/value/i);
});

test("a key that is not 2048 bits is refused with a plain reason before proving", () => {
  const data = JSON.stringify({ SellerGstin: "27DEMOS1234A1Z5", DocTyp: "INV", TotInvVal: 42000, Irn: "ab".repeat(32) });
  const big = ("0x" + "f".repeat(1024)) as `0x${string}`; // 4096 bits
  expect(() => buildCircuitInput(tokenWith(data), big, OWNER, true)).toThrow(/2048-bit/);
});
