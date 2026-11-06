import { expect, test } from "@playwright/test";
import { buyAmount, buyDefault, parseUsdt } from "../src/amount";

// Found in a trial run of the demo: the Buy box showed "1", but pressing Buy answered "Enter an amount", because the box
// displayed a default that the price line and the buy buttons never read. The lifecycle test did not catch it because it
// types its amount first.

test("an untouched Buy box prices the amount it shows", () => {
  expect(buyDefault(3_725_000n)).toBe("1");
  expect(buyAmount(undefined, 3_725_000n)).toBe(1_000_000n);
});

test("when less than one note is left, the box shows what is left and Buy uses it", () => {
  expect(buyDefault(250_000n)).toBe("0.25");
  expect(buyAmount(undefined, 250_000n)).toBe(250_000n);
  expect(buyDefault(123_456n)).toBe("0.123456");
  expect(buyAmount(undefined, 123_456n)).toBe(123_456n);
});

test("whatever the box shows is what gets priced, for any amount left", () => {
  for (const left of [1n, 10_000n, 500_000n, 999_999n, 1_000_000n, 1_000_001n, 3_725_000n, 100_000_000n]) {
    expect(buyAmount(undefined, left), `left ${left}`).toBe(parseUsdt(buyDefault(left)));
  }
});

test("what the visitor typed wins over the default", () => {
  expect(buyAmount("0.5", 3_725_000n)).toBe(500_000n);
  expect(buyAmount(" 2 ", 3_725_000n)).toBe(2_000_000n);
});

test("a box the visitor emptied, or filled with something that is not an amount, is refused", () => {
  expect(buyAmount("", 3_725_000n)).toBeUndefined();
  expect(buyAmount("   ", 3_725_000n)).toBeUndefined();
  expect(buyAmount("abc", 3_725_000n)).toBeUndefined();
  expect(buyAmount("1.1234567", 3_725_000n)).toBeUndefined();
});

test("parseUsdt keeps reading amounts as before", () => {
  expect(parseUsdt("1")).toBe(1_000_000n);
  expect(parseUsdt("0.475")).toBe(475_000n);
  expect(parseUsdt("-1")).toBeUndefined();
});
