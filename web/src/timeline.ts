// An invoice's history, from the chain's own events, in plain words: who did what, when, with the transaction to open.
export interface RawEvent { name: string; args: Record<string, unknown>; blockNumber: bigint; logIndex: number; txHash: string; at?: number }
export interface Step { title: string; detail: string; actor?: string; at?: number; txHash?: string; refused?: boolean }

const usdt = (v: unknown) => {
  const n = BigInt(String(v));
  const frac = (n % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${n / 1_000_000n}.${frac}`;
};
const lc = (a: unknown) => String(a).toLowerCase();

/**
 * Turns the events of one invoice (registry bind, note creation and the note's own events) into ordered steps. Plain transfers
 * of notes between holders are listed too; mints and burns are part of funding and redemption and are not repeated.
 */
export function buildTimeline(events: RawEvent[], who: (addr: string) => string | undefined = () => undefined, noteAddress = ""): Step[] {
  const ZERO = "0x0000000000000000000000000000000000000000";
  const label = (a: unknown) => who(String(a)) ?? `${String(a).slice(0, 6)}…${String(a).slice(-4)}`;
  const steps: { s: Step; block: bigint; idx: number }[] = [];
  for (const e of events) {
    const a = e.args;
    let s: Step | undefined;
    switch (e.name) {
      case "InvoiceBound":
        s = { title: "Invoice verified and recorded", detail: `The contract checked the government signature and bound this invoice once (₹${(Number(BigInt(String(a.valuePaise))) / 100).toLocaleString("en-IN")}). It can never be financed again.`, actor: label(a.binder) };
        break;
      case "NoteCreated":
        s = { title: "Note created", detail: `${usdt(a.faceValue)} USDT of notes, held in escrow by the note until investors buy them.`, actor: label(a.seller) };
        break;
      case "Funded":
        s = { title: "Investor bought notes", detail: `Paid ${usdt(a.price)} USDT, straight to the seller, for ${usdt(a.amount)} notes in one transaction.`, actor: label(a.investor) };
        break;
      case "FundingClosedEarly":
        s = { title: "Funding closed", detail: `${usdt(a.burnedUnsold)} unsold notes were burned.` };
        break;
      case "Settled":
        s = { title: "Debtor paid the invoice", detail: `${usdt(a.faceValue)} USDT paid in; ${usdt(a.paidToSeller)} went to the seller for the unsold part. Holders can redeem.`, actor: label(a.payer) };
        break;
      case "Redeemed":
        s = { title: "Holder redeemed", detail: `${usdt(a.amount)} notes exchanged for ${usdt(a.amount)} USDT.`, actor: label(a.holder) };
        break;
      case "DefaultMarked":
        s = { title: "Marked as defaulted", detail: `Not paid by the due date plus grace. ${usdt(a.outstanding)} notes were outstanding; nothing is paid out.` };
        break;
      case "Transfer": {
        if (lc(a.from) === ZERO || lc(a.to) === ZERO || (noteAddress && (lc(a.from) === lc(noteAddress) || lc(a.to) === lc(noteAddress)))) break;
        s = { title: "Notes passed to another holder", detail: `${usdt(a.value)} notes sent to ${label(a.to)}. The contract checked the receiver's credential first.`, actor: label(a.from) };
        break;
      }
    }
    if (s) steps.push({ s: { ...s, at: e.at, txHash: e.txHash }, block: e.blockNumber, idx: e.logIndex });
  }
  steps.sort((x, y) => (x.block === y.block ? x.idx - y.idx : x.block < y.block ? -1 : 1));
  return steps.map((x) => x.s);
}
