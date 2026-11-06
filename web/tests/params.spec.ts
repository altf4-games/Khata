// URL parameters that change how reads are routed are test hooks. A link someone else crafted must not be able to point the
// app at a different Anon-RPC worker or gateway, or switch reads to direct, so they only work on a local development host.
import { expect, test } from "@playwright/test";
import { readParams } from "../src/params";

const HOOKS = "?anonSpecifier=0x1111111111111111111111111111111111111111&anonGateway=1.2.3.4:5:x&anonNetwork=nym&anonFallback=off&anonBootDeadline=1&anonSlowAfter=1&reads=direct";

test("on the hosted site every routing parameter is ignored", () => {
  for (const host of ["khata-theta-ten.vercel.app", "evil.example", "localhost.evil.example", "127.0.0.1.evil.example"]) {
    const p = readParams(HOOKS, host);
    for (const k of ["anonSpecifier", "anonGateway", "anonNetwork", "anonFallback", "anonBootDeadline", "anonSlowAfter", "reads"]) {
      expect(p.get(k), `${k} on ${host}`).toBeNull();
    }
  }
});

test("on a local development host the parameters work, so the tests can use them", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]", "foo.localhost"]) {
    const p = readParams(HOOKS, host);
    expect(p.get("anonSpecifier")).toBe("0x1111111111111111111111111111111111111111");
    expect(p.get("reads")).toBe("direct");
  }
});

test("parameters that do not route reads are untouched", () => {
  expect(readParams("?utm=1&x=2", "khata-theta-ten.vercel.app").get("utm")).toBe("1");
});
