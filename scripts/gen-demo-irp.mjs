// Generates the DEMO IRP key (once) and a fixed set of signed demo invoices.
// Usage: node scripts/gen-demo-irp.mjs [--new-key]
// Output: contracts/test/fixtures/demo-irp/
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEMO_KID, generateKey, irnFor, modulusHex, signToken } from "./lib/irp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "contracts/test/fixtures/demo-irp");
mkdirSync(dir, { recursive: true });

const privPath = join(dir, "demo-irp.private.pem");
const pubPath = join(dir, "demo-irp.public.pem");
if (process.argv.includes("--new-key") || !existsSync(privPath)) {
  const { publicKey, privateKey } = generateKey();
  writeFileSync(privPath, privateKey);
  writeFileSync(pubPath, publicKey);
  console.log("generated a new DEMO IRP key");
}
const priv = readFileSync(privPath, "utf8");
const pub = readFileSync(pubPath, "utf8");
writeFileSync(join(dir, "demo-irp.modulus.hex"), modulusHex(pub));
writeFileSync(join(dir, "demo-irp.kid"), DEMO_KID);

const SELLER = "27DEMOS1234A1Z5"; // labelled demo GSTINs, not real taxpayers
const BUYER = "29DEMOB5678C1Z2";

function invoice(docNo, rupees, extra = {}) {
  const f = {
    SellerGstin: SELLER,
    BuyerGstin: BUYER,
    DocNo: docNo,
    DocTyp: "INV",
    DocDt: "05/11/2026",
    TotInvVal: rupees,
    ItemCnt: 1,
    MainHsnCode: "010190",
  };
  f.Irn = irnFor({ sellerGstin: f.SellerGstin, docNo: f.DocNo, docDt: f.DocDt, docTyp: f.DocTyp });
  f.IrnDt = "2026-11-05 21:00:00";
  return { ...f, ...extra };
}

const set = {
  "demo-01": invoice("DEMO-0001", 100000),
  "demo-02": invoice("DEMO-0002", 250000.5),
  "demo-03": invoice("DEMO-0003", 75000),
  "demo-04": invoice("DEMO-0004", 42000),
  "demo-05": invoice("DEMO-0005", 9999.99),
};
// Same IRN as demo-01, different bytes (different IrnDt), signed separately: the duplicate block must still hold.
set["demo-dup-irn"] = { ...set["demo-01"], IrnDt: "2026-11-05 21:00:01" };
// No IrnDt, older vintage; its IRN is of course different.
{
  const f = invoice("DEMO-0006", 12000);
  delete f.IrnDt;
  set["demo-no-irndt"] = f;
}
// Credit note, must be refused.
set["demo-credit-note"] = invoice("DEMO-CN01", 5000, { DocTyp: "CRN" });

for (const [name, fields] of Object.entries(set)) {
  writeFileSync(join(dir, `${name}.token`), signToken(priv, fields));
}
// Signed by the demo key under a kid the registry will not know.
writeFileSync(join(dir, "demo-unknown-kid.token"), signToken(priv, set["demo-02"], { kid: "DEMO-IRP-UNREGISTERED" }));
console.log(`wrote ${Object.keys(set).length + 1} tokens to ${dir}`);
