// The worker's code identity is pinned in this app: the specifier contract's workerHash() must still be the hash that was
// reviewed, otherwise the app refuses to start the worker (the harness alone only checks the code against whatever hash the contract says).
import { expect, test } from "@playwright/test";
import { checkPin, PINS, WORKER_HASH_SELECTOR } from "../src/pin";

const TOR = "0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e";
const NYM = "0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0";

test("the pinned hashes are the ones read from the specifier contracts", () => {
  expect(PINS[TOR.toLowerCase()]).toBe("0x5b62f358ce7a2b94ee9bc3a0e6a08757db68fa08fc348276f31eda788aec818b");
  expect(PINS[NYM.toLowerCase()]).toBe("0xf13a448a8721b9d0b20da3d5b80ffe00bf4c5bb3aae812a38d3d1e3bc81fceb8");
  expect(WORKER_HASH_SELECTOR).toBe("0x3898587d");
});

test("the matching hash passes, in either case", () => {
  expect(() => checkPin(TOR, WORKER_HASH_SELECTOR, PINS[TOR.toLowerCase()])).not.toThrow();
  expect(() => checkPin(TOR.toLowerCase(), WORKER_HASH_SELECTOR, PINS[TOR.toLowerCase()].toUpperCase().replace("0X", "0x"))).not.toThrow();
});

test("a changed hash is refused with a message that says what happened", () => {
  const swapped = "0x" + "11".repeat(32);
  expect(() => checkPin(TOR, WORKER_HASH_SELECTOR, swapped)).toThrow(/worker.*changed|changed.*worker/i);
  // one network's hash is not accepted for the other
  expect(() => checkPin(NYM, WORKER_HASH_SELECTOR, PINS[TOR.toLowerCase()])).toThrow();
});

test("other reads and unknown specifiers are not affected", () => {
  expect(() => checkPin(TOR, "0x12345678", "0x00")).not.toThrow(); // not a workerHash() call
  expect(() => checkPin("0x0000000000000000000000000000000000000001", WORKER_HASH_SELECTOR, "0x00")).not.toThrow(); // test hook specifier: no pin
});
