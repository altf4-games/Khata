import { expect, test } from "@playwright/test";
import { nymCannotCarry } from "../src/route";

// Found while recording the demo on a network where Tor's gateway was unreachable: on the Nym fallback every Arkiv read
// came back "HTTP 415: Content-Type: application/json is required" (the same read answers 200 directly and over Tor, and
// Whitechain's RPC answers over Nym), so the marketplace and the credential never loaded. Arkiv reads are sent directly
// on Nym, counted as direct reads, and the chip's share says so.

test("Arkiv requests are not sent over Nym; Whitechain requests are", () => {
  const arkiv = "https://rpc.rabdi.db-chain.testnet.arkiv.network/abc123";
  expect(nymCannotCarry("Nym", arkiv)).toBe(true);
  expect(nymCannotCarry("Nym", "https://rpc.testnet.whitechain.io")).toBe(false);
});

test("Tor carries Arkiv requests", () => {
  expect(nymCannotCarry("Tor", "https://rpc.rabdi.db-chain.testnet.arkiv.network/abc123")).toBe(false);
});

test("a lookalike host or a malformed address is not treated as Arkiv", () => {
  expect(nymCannotCarry("Nym", "https://arkiv.network.evil.example/")).toBe(false);
  expect(nymCannotCarry("Nym", "not a url")).toBe(false);
});
