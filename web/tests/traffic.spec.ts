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
