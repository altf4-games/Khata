// The checks behind the Privacy page and the "ready" signal.
import { expect, test } from "@playwright/test";
import { routeSelfTest, verdictOf, whatTheRpcSaw } from "../src/selftest";

const reply = (body: string, ok = true, status = 200) => async () => ({ ok, status, text: async () => body });

test("the self-test passes for the expected chain and says why it fails otherwise", async () => {
  await expect(routeSelfTest(reply('{"jsonrpc":"2.0","id":1,"result":"0x752"}'), "https://rpc", 1874)).resolves.toBeUndefined();
  await expect(routeSelfTest(reply('{"result":"0x1"}'), "https://rpc", 1874)).rejects.toThrow(/expected 1874/);
  await expect(routeSelfTest(reply("<html>challenge</html>"), "https://rpc", 1874)).rejects.toThrow(/not JSON-RPC/);
  await expect(routeSelfTest(reply("", false, 403), "https://rpc", 1874)).rejects.toThrow(/HTTP 403/);
  await expect(routeSelfTest(() => new Promise(() => {}), "https://rpc", 1874, 50)).rejects.toThrow(/in time/);
});

test("the comparison says the route works only when the two addresses differ", async () => {
  const works = await whatTheRpcSaw(async () => "203.0.113.7", async () => "198.51.100.9");
  expect(verdictOf(works).ok).toBe(true);
  expect(verdictOf(works).text).toContain("198.51.100.9");
  const leaks = await whatTheRpcSaw(async () => "203.0.113.7", async () => "203.0.113.7");
  expect(verdictOf(leaks).ok).toBe(false);
  const noRoute = await whatTheRpcSaw(async () => "203.0.113.7", async () => { throw new Error("x"); });
  expect(verdictOf(noRoute)).toMatchObject({ ok: false });
  expect(noRoute.error).toMatch(/private route/);
});

test("the self-test is retried, so one unanswered first read does not fail a route that works", async () => {
  const { routeSelfTestWithRetries } = await import("../src/selftest");
  let calls = 0;
  const flaky = async () => { calls++; if (calls === 1) throw new Error("no answer"); return { ok: true, status: 200, text: async () => '{"result":"0x752"}' }; };
  await expect(routeSelfTestWithRetries(flaky, "https://rpc", 1874, 3, 10)).resolves.toBeUndefined();
  expect(calls).toBe(2);
  await expect(routeSelfTestWithRetries(async () => { throw new Error("still down"); }, "https://rpc", 1874, 2, 10)).rejects.toThrow("still down");
});
