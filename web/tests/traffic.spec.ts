// The traffic counter behind the "share of reads through Anon-RPC" claim.
import { expect, test } from "@playwright/test";
import { Traffic } from "../src/traffic";

test("share counts only reads, and a direct read lowers it", () => {
  const t = new Traffic();
  expect(t.share()).toBeUndefined(); // nothing read yet: no claim
  t.read("anon"); t.read("anon"); t.read("anon");
  expect(t.share()).toBe(1);
  t.read("direct");
  expect(t.share()).toBeCloseTo(0.75);
});

test("broadcasting a signed transaction and the one specifier read are counted apart and never inflate the share", () => {
  const t = new Traffic();
  t.read("anon");
  t.excluded("broadcast"); t.excluded("broadcast"); t.excluded("bootstrap");
  expect(t.share()).toBe(1);
  expect(t.snapshot()).toMatchObject({ anon: 1, direct: 0, broadcast: 2, bootstrap: 1 });
});

test("a failed anonymous read is not counted as anonymous", () => {
  const t = new Traffic();
  t.read("anon"); t.failed();
  expect(t.snapshot()).toMatchObject({ anon: 1, failed: 1 });
  expect(t.share()).toBe(1); // failures were never sent directly
});

test("every read is logged with its route, method names, outcome and time, and the log can be audited", () => {
  const t = new Traffic();
  t.record({ route: "anon", methods: ["eth_call"], ms: 1800, ok: true });
  t.record({ route: "anon", methods: ["eth_getLogs", "eth_blockNumber"], ms: 2400, ok: false });
  t.record({ route: "broadcast", methods: ["eth_sendRawTransaction"], ms: 900, ok: true });
  const log = t.log();
  expect(log).toHaveLength(3);
  expect(log[0]).toMatchObject({ route: "anon", methods: ["eth_call"], ok: true });
  expect(log[1].ok).toBe(false);
  expect(t.directReads(), "no read left the worker").toEqual([]);
  t.record({ route: "direct", methods: ["eth_call"], ms: 300, ok: true });
  expect(t.directReads()).toHaveLength(1);
});

test("the log keeps only the most recent entries", () => {
  const t = new Traffic();
  for (let i = 0; i < 250; i++) t.record({ route: "anon", methods: ["eth_call"], ms: i, ok: true });
  expect(t.log()).toHaveLength(200);
  expect(t.log()[199].ms).toBe(249);
});
