// The live suites merge into the evidence files, so a step that runs once per deployment is never dropped by a later run.
import { expect, test } from "@playwright/test";
import { mergeEvidence } from "../../scripts/lib/evidence.mjs";

const H = (n: number) => "0x" + String(n).padStart(64, "0");
const header = { chainId: "1874", KhataRegistry: "0xR1" };

test("a later run keeps steps it skipped, replaces steps it repeated, and keeps the reason for a refusal", () => {
  const first = mergeEvidence(undefined, header, [{ label: "bind NIC sample", hash: H(1), status: "success" }, { label: "rescan (refused)", hash: H(2), status: "reverted", reason: "IrnAlreadyFinanced" }]);
  const second = mergeEvidence(first, header, [{ label: "rescan (refused)", hash: H(3), status: "reverted", reason: "IrnAlreadyFinanced" }]);
  expect(second.entries).toEqual([
    { label: "bind NIC sample", hash: H(1), status: "success" },
    { label: "rescan (refused)", hash: H(3), status: "reverted", reason: "IrnAlreadyFinanced" },
  ]);
});

test("a new deployment starts the list again", () => {
  const old = mergeEvidence(undefined, header, [{ label: "bind NIC sample", hash: H(1), status: "success" }]);
  expect(mergeEvidence(old, { ...header, KhataRegistry: "0xR2" }, [{ label: "x", hash: H(4), status: "success" }]).entries).toEqual([{ label: "x", hash: H(4), status: "success" }]);
});
