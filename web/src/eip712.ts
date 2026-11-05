// The attesters' typed data, shared by the UI, the live tests and the standalone second-issuer script.
export const ELIGIBILITY_TYPES = {
  Eligibility: [
    { name: "subject", type: "address" },
    { name: "tier", type: "uint8" },
    { name: "jurisdiction", type: "uint16" },
    { name: "validUntil", type: "uint64" },
    { name: "credId", type: "bytes32" },
  ],
} as const;
export const REVOCATION_TYPES = { Revocation: [{ name: "credId", type: "bytes32" }] } as const;
export const SELLER_BINDING_TYPES = {
  SellerBinding: [
    { name: "gstinHash", type: "bytes32" },
    { name: "wallet", type: "address" },
    { name: "validUntil", type: "uint64" },
    { name: "version", type: "uint64" },
  ],
} as const;
