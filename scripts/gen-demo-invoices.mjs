// Signs a pool of fresh invoices with the labelled DEMO IRP key so the web demo always has an unbound one.
// The output holds only signed tokens (public data); the private key stays in contracts/test/fixtures (not tracked).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "./lib/chain.mjs";
import { irnFor, signToken } from "./lib/irp.mjs";

const SELLER_GSTIN = "27DEMOS1234A1Z5"; // the demo seller whose wallet the attester binds
const count = Number(process.argv[2] ?? 24);
// small enough that the demo wallets (a few USDT in total) can pay them: Rs 1 = 0.0001 USDT in the demo rate
const amounts = [32000, 18500, 26500, 9800, 37250, 15000, 31000, 12400, 22000, 36000, 8600, 29900];
const pem = readFileSync(join(root, "contracts/test/fixtures/demo-irp/demo-irp.private.pem"), "utf8");
const stamp = Date.now().toString(36).toUpperCase();
const out = [];
for (let i = 0; i < count; i++) {
  const f = {
    SellerGstin: SELLER_GSTIN, BuyerGstin: "29DEMOB5678C1Z2", DocNo: `KH${stamp}${i + 1}`, DocTyp: "INV",
    DocDt: "06/11/2026", TotInvVal: amounts[i % amounts.length], ItemCnt: 1, MainHsnCode: "010190",
  };
  f.Irn = irnFor({ sellerGstin: f.SellerGstin, docNo: f.DocNo, docDt: f.DocDt, docTyp: f.DocTyp });
  f.IrnDt = "2026-11-06 10:00:00";
  out.push({ docNo: f.DocNo, rupees: f.TotInvVal, token: signToken(pem, f) });
}
writeFileSync(join(root, "web/src/demo-invoices.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`wrote ${out.length} demo invoices (first ${out[0].docNo})`);
