// The second lender's rule for one credential, kept apart from the network code so it can be tested.
export type Verdict = { ok: true } | { ok: false; reason: string };

/** A credential is acceptable only if it verifies and its own attester has not revoked it, on Arkiv or on Whitechain. */
export function decide(v: Verdict, revokedOnArkiv: boolean, revokedOnChain: boolean): Verdict {
  if (!v.ok) return v;
  if (revokedOnChain) return { ok: false, reason: "the attester revoked it on Whitechain" };
  if (revokedOnArkiv) return { ok: false, reason: "the attester published a revocation on Arkiv" };
  return { ok: true };
}
