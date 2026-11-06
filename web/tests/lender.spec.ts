// The independent second lender (scripts/second-issuer.ts) must not accept a revoked credential.
import { expect, test } from "@playwright/test";
import { decide } from "../../scripts/lib/lender";

test("a verified credential is accepted only while its attester has not revoked it anywhere", () => {
  expect(decide({ ok: true }, false, false)).toEqual({ ok: true });
  expect(decide({ ok: true }, true, false).ok).toBe(false);
  expect(decide({ ok: true }, false, true).ok).toBe(false);
  expect(decide({ ok: false, reason: "expired" }, false, false)).toEqual({ ok: false, reason: "expired" });
});
