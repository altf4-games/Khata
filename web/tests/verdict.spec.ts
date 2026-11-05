import { expect, test } from "@playwright/test";
import { classify, formatRupees } from "../src/verdict";

const base = { kid: "K", keyRegistered: true, keyActive: true, keyIsDemo: false, signatureValid: true, alreadyBound: false };

test("a verified, active, unbound invoice is verified", () => {
  expect(classify(base)).toBe("verified");
});

test("an already bound invoice is flagged as financed", () => {
  expect(classify({ ...base, alreadyBound: true })).toBe("financed");
});

test("a retired key is never shown as verified (red team: green banner for a retired key)", () => {
  expect(classify({ ...base, keyActive: false })).toBe("keyRetired");
  expect(classify({ ...base, keyActive: false, alreadyBound: true })).toBe("keyRetired");
});

test("an unregistered key is refused", () => {
  expect(classify({ ...base, keyRegistered: false, keyActive: false, signatureValid: false })).toBe("unknownKey");
});

test("a bad signature is refused", () => {
  expect(classify({ ...base, signatureValid: false })).toBe("badSignature");
});

test("rupee formatting keeps full precision for very large values (no float rounding)", () => {
  expect(formatRupees(200n)).toBe("₹ 2.00");
  expect(formatRupees(25000050n)).toBe("₹ 2,50,000.50");
  expect(formatRupees(5n)).toBe("₹ 0.05");
  // 15 integer digits, the largest the contract accepts: a Number would round this
  expect(formatRupees(99999999999999999n)).toBe("₹ 99,99,99,99,99,99,999.99");
  expect(formatRupees(100000000000000001n)).toBe("₹ 1,00,00,00,00,00,00,000.01");
});

test("rupee formatting agrees with BigInt en-IN grouping for many values", () => {
  const oracle = (p: bigint) => `₹ ${(p / 100n).toLocaleString("en-IN")}.${(p % 100n).toString().padStart(2, "0")}`;
  for (const p of [0n, 1n, 99n, 100n, 99999n, 100000n, 123456789n, 9999999999n, 10000000000n, 123456789012345n]) {
    expect(formatRupees(p)).toBe(oracle(p));
  }
});
