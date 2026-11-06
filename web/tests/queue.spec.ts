import { expect, test } from "@playwright/test";
import { oneAtATime, wholeIn } from "../src/queue";

test("two sends from one wallet run one after the other, and a failure does not block the next", async () => {
  const log: string[] = [];
  const job = (name: string, ms: number, fail = false) => async () => { log.push(`start ${name}`); await new Promise((r) => setTimeout(r, ms)); log.push(`end ${name}`); if (fail) throw new Error(name); return name; };
  const a = oneAtATime("0xAbC", job("a", 80, true));
  const b = oneAtATime("0xabc", job("b", 10));
  const c = oneAtATime("0xdef", job("c", 10)); // another wallet does not wait
  await expect(a).rejects.toThrow("a");
  await expect(b).resolves.toBe("b");
  await c;
  expect(log.indexOf("start b")).toBeGreaterThan(log.indexOf("end a"));
  expect(log.indexOf("start c")).toBeLessThan(log.indexOf("end a"));
});

test("only plain whole numbers in range are accepted", () => {
  expect(wholeIn("2", 0, 3)).toBe(2);
  expect(wholeIn(" 0 ", 0, 3)).toBe(0);
  for (const bad of ["2.5", "300", "-1", "1e2", "", "two", "0x2"]) expect(wholeIn(bad, 0, 255), bad).toBeUndefined();
});
