// Signing helpers for the labelled "DEMO IRP (not government)" key.
// This mimics the shape of a NIC signed QR token so lifecycle tests are not tied to the Rs 2 sample.
import { createHash, createSign, generateKeyPairSync, createPublicKey } from "node:crypto";

export const DEMO_KID = "DEMO-IRP-NOT-GOVERNMENT-1";

const b64u = (buf) => Buffer.from(buf).toString("base64url");

/** Real IRN rule: SHA-256 of SellerGstin + financial year + document type + document number. */
export function irnFor({ sellerGstin, docNo, docDt, docTyp = "INV" }) {
  const [, month, year] = docDt.split("/").map(Number);
  const startYear = month >= 4 ? year : year - 1;
  const fy = `${startYear}-${String(startYear + 1).slice(2)}`;
  return createHash("sha256").update(`${sellerGstin}${fy}${docTyp}${docNo}`).digest("hex");
}

/** Builds and signs a token. `fields` are the inner invoice fields; key order is preserved as given. */
export function signToken(privatePem, fields, { kid = DEMO_KID, alg = "RS256" } = {}) {
  const header = b64u(JSON.stringify({ alg, kid, typ: "JWT" }));
  const payload = b64u(JSON.stringify({ iss: "NIC", data: JSON.stringify(fields) }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  const sig = signer.sign(privatePem);
  return `${header}.${payload}.${b64u(sig)}`;
}

export function generateKey() {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicExponent: 0x10001,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

export function modulusHex(publicPem) {
  const jwk = createPublicKey(publicPem).export({ format: "jwk" });
  return "0x" + Buffer.from(jwk.n, "base64url").toString("hex");
}
