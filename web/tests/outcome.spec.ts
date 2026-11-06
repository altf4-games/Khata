// A finished action links to the right explorer and keeps the words the action chose (for example a partial success).
import { expect, test } from "@playwright/test";
import { doneMsg, txLink } from "../src/outcome";
import deployment from "../../deployments/whitechain-sepolia.json" with { type: "json" };

const H = ("0x" + "ab".repeat(32)) as `0x${string}`;

test("an Arkiv transaction links to the Arkiv explorer, a Whitechain one to Whitechain's", () => {
  expect(new URL(txLink(H, "arkiv")).host).toBe("rabdi.explorer.arkiv.network");
  expect(new URL(txLink(H)).origin).toBe(new URL(deployment.explorer).origin);
});

test("an action's own detail (such as 'only Whitechain was updated') is kept, with its transaction link", () => {
  const m = doneMsg({ hash: H, gasUsed: 50_000n, detail: "Arkiv could not be reached, so only Whitechain was updated." }, "Credential revoked", "default words");
  expect(m.detail).toContain("only Whitechain was updated");
  expect(m.hash).toBe(H);
});

test("without its own detail, the default words or the gas used are shown; an Arkiv write shows no gas line", () => {
  expect(doneMsg({ hash: H, gasUsed: 50_000n }, "Done", "Words").detail).toBe("Words");
  expect(doneMsg({ hash: H, gasUsed: 50_000n }, "Done").detail).toMatch(/50,000 gas/);
  expect(doneMsg({ hash: H, gasUsed: 0n, chain: "arkiv" }, "Done").detail).toBeUndefined();
  expect(doneMsg({ hash: H, gasUsed: 0n, chain: "arkiv" }, "Done").chain).toBe("arkiv");
});
