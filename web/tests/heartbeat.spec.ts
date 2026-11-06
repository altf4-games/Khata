import { expect, test } from "@playwright/test";
import { heartbeatStatus, HEARTBEAT_SECONDS } from "../src/heartbeat";
import { arkivTrace, clearTrace, trace } from "../src/trace";

const A = "0xB288ae1aaAeB761520D4A72bb87DbB6ef11126Db";

test("no heartbeat entity means the attester is not shown as live", () => {
  expect(heartbeatStatus([], A, () => 0)).toEqual({ state: "none" });
});
test("the newest heartbeat the attester itself wrote makes it live, with the time left", () => {
  const s = heartbeatStatus([{ seq: 5, owner: A, attester: A }, { seq: 9, owner: A.toLowerCase(), attester: A }], A, (seq) => (seq === 9 ? 100 : 500));
  expect(s).toEqual({ state: "live", seq: 9, renewsInSeconds: HEARTBEAT_SECONDS - 100 });
});
test("a heartbeat written by someone else for the attester does not count", () => {
  expect(heartbeatStatus([{ seq: 99, owner: "0x000000000000000000000000000000000000dEaD", attester: A }], A, () => 0)).toEqual({ state: "none" });
  expect(heartbeatStatus([{ seq: 1, owner: A, attester: "0x000000000000000000000000000000000000dEaD" }], A, () => 0)).toEqual({ state: "none" });
});

test("the Arkiv trace records queries in words, merges a burst of the same one, and keeps only the latest", () => {
  clearTrace();
  trace("khata.credential", "subject = 0x54E2… AND validUntil > now", "find the investor's credentials", 1000);
  trace("khata.credential", "subject = 0x54E2… AND validUntil > now", "find the investor's credentials", 1200);
  expect(arkivTrace()).toHaveLength(1);
  for (let i = 0; i < 40; i++) trace("khata.listing", `dueDate > ${i}`, "marketplace", 10_000 + i * 2000);
  expect(arkivTrace()).toHaveLength(30);
  expect(arkivTrace()[29].where).toBe("dueDate > 39");
});
