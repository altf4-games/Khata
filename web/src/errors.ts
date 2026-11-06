// Plain-language messages for the contract's custom errors. No raw selectors or hex shown to the user.

export interface Refusal {
  title: string;
  detail: string;
}

type Args = readonly unknown[] | undefined;

const REASON_TEXT = [
  "",
  "It has no credential.",
  "Its credential has expired.",
  "Its credential was revoked by the attester.",
  "The attester that issued its credential is no longer trusted.",
];

export function refusalFor(name: string | undefined, args: Args, fallback?: string): Refusal {
  const first = args && args.length > 0 ? String(args[0]) : "";
  switch (name) {
    case "IrnAlreadyFinanced":
      return {
        title: "Refused: this invoice is already financed",
        detail: "Khata binds each invoice number (IRN) once. A second financing of the same invoice reverts, even with a freshly signed copy.",
      };
    case "ProofNotForCaller":
      return { title: "Refused: this proof belongs to another wallet", detail: "A proof names the wallet that made it, so nobody else can submit it. Make the proof from the wallet that will finance the invoice." };
    case "UnknownZkKey":
      return { title: "Refused: the proof was made for a key that is not registered", detail: "The proof must come from a signing key the registry knows. Only 2048-bit keys can be used with proofs." };
    case "DemoFlagMismatch":
      return { title: "Refused: the proof mixes a demo key with a government key", detail: "Invoices from a labelled demo key and from a government key are kept apart." };
    case "ZkKeyRetired":
      return { title: "Refused: that signing key is retired", detail: "The registry no longer accepts new invoices signed by this key." };
    case "InvalidProof":
    case "BadProofInputs":
      return { title: "Refused: the proof did not check out", detail: "The contract's verifier rejected it, so nothing was recorded." };
    case "ZkNotEnabled":
      return { title: "Binding by proof is not switched on", detail: "This registry has no proof verifier set." };
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
    case "SellerNotRegistered":
      return {
        title: "Refused: this seller has no authorised wallet",
        detail: "An attester must first bind the seller's GSTIN to a wallet. Without that, anyone holding the QR could register the invoice first.",
      };
    case "NotSellerWallet":
      return {
        title: "Refused: only the seller's wallet can register this invoice",
        detail: "The QR names a seller whose authorised wallet is a different address. Holding the QR is not enough.",
      };
    case "SellerBindingExpired":
      return { title: "Refused: the seller's wallet authorisation has expired", detail: "Ask the attester to sign a fresh binding for this seller." };
    case "StaleBinding":
      return { title: "Refused: that authorisation is out of date", detail: "A newer binding for this GSTIN already exists, so the older signed copy cannot be replayed." };
    case "NotBinder":
      return { title: "Refused: only the wallet that registered the invoice can create its note", detail: "Switch to the supplier wallet that registered it." };
    case "NoteExists":
      return { title: "A note already exists for this invoice", detail: "Each invoice gets exactly one note. Open it from the list." };
    case "InvalidTerms":
      return { title: "Refused: those terms are not allowed", detail: "The due date must be after the cool-off, the discount at most 50%, and the grace period at most 90 days." };
    case "InvoiceNotBound":
      return { title: "Refused: this invoice is not registered yet", detail: "Register the invoice first, then create its note." };
    case "CoolOffActive":
      return { title: "Not yet: the cool-off is still running", detail: `Funding opens at ${new Date(Number(first) * 1000).toLocaleTimeString("en-IN")}. The wait gives a cancelled e-invoice time to surface before money moves.` };
    case "FundingClosed":
      return { title: "Funding is closed", detail: "The seller closed funding on this note." };
    case "FundingEnded":
      return { title: "Funding has ended", detail: "The funding deadline for this note has passed." };
    case "ExceedsAvailable":
      return { title: "Not enough notes left to buy", detail: `Only ${(Number(first) / 1e6).toFixed(2)} notes are still for sale. Choose a smaller amount.` };
    case "ZeroAmount":
      return { title: "Enter an amount", detail: "The amount must be more than zero." };
    case "ReceiverNotEligible":
      return {
        title: "Blocked: the receiver has no valid credential",
        detail: `${REASON_TEXT[Number(args?.[1])] ?? "The receiver is not eligible."} Notes can only be held by wallets with a valid credential from an accepted attester.`,
      };
    case "ReceiverTierTooLow":
      return { title: "Blocked: the receiver's credential tier is too low", detail: "This note requires a higher credential tier than the receiver holds." };
    case "ReceiverIsNote":
      return { title: "Blocked: notes cannot be sent to the note contract", detail: "Choose a person's wallet." };
    case "TransferAfterMaturity":
      return { title: "Blocked: transfers stop at maturity", detail: "The note is past its due date. Holders can only redeem after the debtor pays." };
    case "WrongPhase":
      return { title: "Not possible in this state", detail: "That step does not apply to the note's current phase (funding, settled or defaulted)." };
    case "NotYetDue":
      return { title: "Not yet due", detail: `The debtor can settle from ${new Date(Number(first) * 1000).toLocaleString("en-IN")}.` };
    case "NotInDefault":
      return { title: "Not in default yet", detail: `A note can be marked defaulted from ${new Date(Number(first) * 1000).toLocaleString("en-IN")} (due date plus grace).` };
    case "NothingToRedeem":
      return { title: "Nothing to redeem", detail: "This wallet holds no notes." };
    case "NotSellerOrFundingOpen":
      return { title: "Only the seller can close funding", detail: "Switch to the supplier wallet." };
    case "CredentialExpired":
      return { title: "Refused: that signed credential has already expired", detail: "Choose a validity period in the future." };
    case "UnknownAttester":
      return { title: "Refused: the signer is not an accepted attester", detail: "Only attesters added by the registry owner are trusted." };
    case "CredentialIsRevoked":
      return { title: "Refused: that credential was revoked", detail: "A revoked credential ID cannot be registered again." };
    default:
      if (fallback && /insufficient funds|exceeds the balance/i.test(fallback)) {
        return { title: "This wallet is out of testnet WBT", detail: "It cannot pay the network fee. Send it a little testnet WBT from the faucet or the deployer." };
      }
      return {
        title: "The request was refused",
        detail: fallback ?? "The contract or the network rejected this. Try again, or check the network indicator above.",
      };
  }
}
