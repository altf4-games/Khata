// Pure presentation logic, kept free of the DOM so it can be tested directly.

export interface Checked {
  keyRegistered: boolean;
  keyActive: boolean;
  signatureValid: boolean;
  alreadyBound: boolean;
}

export type Verdict = "verified" | "financed" | "keyRetired" | "unknownKey" | "badSignature";

/** Decides what the panel may claim. Order matters: a retired key is never shown as verified. */
export function classify(r: Checked): Verdict {
  if (!r.keyRegistered) return "unknownKey";
  if (!r.signatureValid) return "badSignature";
  if (!r.keyActive) return "keyRetired";
  return r.alreadyBound ? "financed" : "verified";
}

/** Formats hundredths of a rupee with Indian digit grouping, using integers only (no float rounding). */
export function formatRupees(paise: bigint): string {
  const whole = (paise / 100n).toString();
  const cents = (paise % 100n).toString().padStart(2, "0");
  let grouped: string;
  if (whole.length <= 3) grouped = whole;
  else {
    const tail = whole.slice(-3);
    const head = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    grouped = `${head},${tail}`;
  }
  return `₹ ${grouped}.${cents}`;
}
