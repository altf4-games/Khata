# Reach

## Who is it for, and would they use it?

Three groups would read from Khata's Arkiv entities.

- Small Indian suppliers who sell on credit and wait 60 to 90 days to be paid. They list a financed invoice on the marketplace.
- Investors, who browse listings and keep a credential that lets them hold notes.
- Other lenders and attesters. A lender who has no integration with Khata can read an investor's credential and its revocations from Arkiv and check them (`scripts/second-issuer.ts`). An attester can publish credentials that anyone can verify.

I have not tested this with any real supplier, investor or attester. Nobody outside my own testing has used it, and I won't claim otherwise. What I can show is that the second-lender path works without my app: it accepted an investor from the attester's Arkiv credentials alone.

## Can they try it today?

Yes: https://khata-theta-ten.vercel.app. Pick a role from the switcher and every step runs on Whitechain Sepolia and Arkiv Rabdi, with labelled demo wallets, so no wallet or funds are needed. The Attester role publishes a credential to Arkiv and the Investor role finds it there. The Supplier role publishes a listing to the marketplace.

To check the data without the app, run the query in `schema.md`, or count everything Khata holds by type and writer:

```bash
npx tsx scripts/arkiv-reach.ts
```

The count I got on 6 November 2026 at 21:07 IST:

| Entity type | Live now | Written by |
|---|---|---|
| khata.credential | 1 | attester (demo) |
| khata.revocation | 1 | attester (demo) |
| khata.listing | 2 | supplier (demo) |
| khata.heartbeat | 0 | |

The numbers are small because credentials, revocations and heartbeats expire, so the live count is whatever was written recently, not a running total. The two live listings are from my own test runs.

## Will I keep building it after Mumbai?

Yes, I plan to keep building it after Mumbai, starting with the parts the demo stands in for. First, let users connect their own wallets instead of the demo wallets held by my signer. Second, find a real attester that can be held accountable for who it credentials, since the credentials on Arkiv are only as good as that signer. Third, host my own Anon-RPC gateway so reads don't depend on EF's demo gateway. After that I'd like to run a small testnet pilot with a lender or an invoice-discounting firm, and look at what an invoice note is under Indian rules before any mainnet deployment. None of these has started yet.
