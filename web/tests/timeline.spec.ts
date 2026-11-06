import { expect, test } from "@playwright/test";
import { buildTimeline, type RawEvent } from "../src/timeline";

const NOTE = "0x0109104CAEF5aE82ecF6A6d9e4B09918F0b08480";
const SELLER = "0xa03d3c24469DD58EAE3AE230781f293850A7686b";
const INV = "0x54E2221e61E436D7FF101640CF1edCC983dd75A5";
const Z = "0x0000000000000000000000000000000000000000";
const ev = (name: string, args: Record<string, unknown>, block: number, idx = 0): RawEvent => ({ name, args, blockNumber: BigInt(block), logIndex: idx, txHash: "0x" + String(block * 10 + idx).padStart(64, "0"), at: 1_800_000_000 + block });
const names = (a: string) => ({ [SELLER.toLowerCase()]: "Supplier", [INV.toLowerCase()]: "Investor A" }[a.toLowerCase()]);

test("an invoice's life reads as ordered plain steps with who acted and the transaction", () => {
  const steps = buildTimeline([
    ev("Redeemed", { holder: INV, amount: 3_000_000n }, 9),
    ev("Funded", { investor: INV, amount: 3_000_000n, price: 2_850_000n }, 5, 2),
    ev("Transfer", { from: NOTE, to: INV, value: 3_000_000n }, 5, 1), // the mint to the investor: part of funding
    ev("InvoiceBound", { binder: SELLER, valuePaise: 4_200_000n }, 1),
    ev("NoteCreated", { seller: SELLER, faceValue: 4_200_000n }, 2),
    ev("Settled", { payer: "0x51AA941485d769C56fFbc3a95c6e2628A1B07dE3", faceValue: 4_200_000n, paidToSeller: 600_000n }, 8),
  ], names, NOTE);
  expect(steps.map((s) => s.title)).toEqual(["Invoice verified and recorded", "Note created", "Investor bought notes", "Debtor paid the invoice", "Holder redeemed"]);
  expect(steps[0].actor).toBe("Supplier");
  expect(steps[0].detail).toContain("₹42,000");
  expect(steps[2].detail).toBe("Paid 2.85 USDT, straight to the seller, for 3.00 notes in one transaction.");
  expect(steps[4].actor).toBe("Investor A");
  expect(steps.every((s) => /^0x[0-9a-f]{64}$/.test(s.txHash))).toBe(true);
});

test("a transfer between two holders is a step; mints and burns are not repeated", () => {
  const steps = buildTimeline([
    ev("Transfer", { from: Z, to: INV, value: 1n }, 3),
    ev("Transfer", { from: INV, to: SELLER, value: 500_000n }, 4),
    ev("Transfer", { from: INV, to: Z, value: 1n }, 5),
  ], names, NOTE);
  expect(steps).toHaveLength(1);
  expect(steps[0].title).toBe("Notes passed to another holder");
  expect(steps[0].detail).toContain("Supplier");
});

test("a default is stated plainly", () => {
  const [s] = buildTimeline([ev("DefaultMarked", { outstanding: 3_600_000n }, 4)]);
  expect(s.title).toBe("Marked as defaulted");
  expect(s.detail).toContain("3.60");
});
