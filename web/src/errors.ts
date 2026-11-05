// Plain-language messages for the contract's custom errors. No raw selectors or hex shown to the user.

export interface Refusal {
  title: string;
  detail: string;
}

type Args = readonly unknown[] | undefined;

export function refusalFor(name: string | undefined, args: Args, fallback?: string): Refusal {
  const first = args && args.length > 0 ? String(args[0]) : "";
  switch (name) {
    case "IrnAlreadyFinanced":
      return {
        title: "Refused: this invoice is already financed",
        detail: "Khata binds each invoice number (IRN) once. A second financing of the same invoice reverts, even with a freshly signed copy.",
      };
    case "InvalidSignature":
      return {
        title: "Refused: the signature does not match",
        detail: "The invoice data was changed after it was signed, or it was signed with a different key. Nothing was financed.",
      };
    case "UnknownKey":
      return {
        title: "Refused: unknown signing key",
        detail: `The QR names a signing key (kid ${first}) that Khata does not trust. Only registered government keys are accepted.`,
      };
    case "KeyIsRetired":
      return {
        title: "Refused: this signing key was retired",
        detail: `The key ${first} can no longer be used for new invoices. Bindings made earlier are not affected.`,
      };
    case "InvalidField":
      if (first === "DocTyp") {
        return {
          title: "Refused: only tax invoices can be financed",
          detail: "This document is not an invoice (INV). Credit notes and debit notes are not accepted.",
        };
      }
      return { title: "Refused: the invoice has an unusable field", detail: `The field "${first}" is missing, malformed or out of range.` };
    case "MissingField":
      return { title: "Refused: the invoice is incomplete", detail: `The field "${first}" is missing from the signed data.` };
    case "WrongIssuer":
      return { title: "Refused: not issued by NIC", detail: "The token does not name NIC as its issuer." };
    case "UnsupportedAlgorithm":
      return { title: "Refused: unsupported signature type", detail: "Only RS256 signatures, which NIC uses, are accepted." };
    case "TokenTooLarge":
    case "MalformedToken":
    case "MissingKid":
    case "MalformedJson":
    case "DuplicateKey":
    case "InvalidBase64Char":
      return {
        title: "This does not look like a NIC e-invoice QR",
        detail: "The text is not a valid signed token. Scan the QR printed on the e-invoice, or paste its full text.",
      };
    default:
      return {
        title: "The request was refused",
        detail: fallback ?? "The contract or the network rejected this. Try again, or check the network indicator above.",
      };
  }
}
