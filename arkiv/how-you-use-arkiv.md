# How Khata uses Arkiv

Two questions: do the fields I filter on, who can edit each entity and when it expires fit what the app does, and does each Arkiv feature I use change something a user sees. The entities and fields are in `schema.md`. This file goes through each feature and says what a user sees because of it.

## Filters

| What the user is doing | The query | What they see |
|---|---|---|
| Investor opens their desk | credentials where `subject` is their wallet and `validUntil` is greater than now, ordered by `validUntil` | a "Found on Arkiv" banner offering a credential for this wallet, with its tier and expiry, and a button to register it on Whitechain |
| Investor browses notes | listings where `status` is `open` and `dueDate` is greater than now, optionally `discountBps` at or above a floor and `dueDate` within a window, sorted by `dueDate` or `discountBps` | the marketplace, with filters for status, minimum discount and due-within, and a sort control |
| Supplier checks their listing | listings where `seller` is their wallet, with no status filter | their own listing, including "Listing closed", so closing it does not make it vanish from their view |
| A lender checks an investor | credentials by `subject`, then revocations by `attester` and `credId` | the second-lender script's verdict; see below |
| Attester desk | heartbeats by `attester`, newest `seq` first | "running" or "silent", depending on whether a heartbeat is younger than 600 seconds |

Each filtered field is indexed. `jurisdiction`, `title` and `signature` are stored but not filtered on. I did not filter on anything I did not index.

Arkiv alone decides nothing. A credential from Arkiv counts only if its EIP-712 signature recovers to the attester named in the entity, the entity's owner is that attester, and Whitechain's AttesterRegistry accepts that attester. A listing counts only if the factory on Whitechain says this note was made for this invoice and this seller. I tested the cases that must be refused: a tampered tier, a copied signature published from another wallet, a self-signed credential from an unaccepted wallet, an expired credential, and a listing whose owner is not the note's seller.

## Who can edit each entity

Every entity is owned by the wallet that signed the transaction that created it, and Arkiv rejects any mutation from another wallet. A credential, a revocation and a heartbeat are owned by the attester. A listing is owned by the supplier. That matches who should be able to change them: nobody else can retract an attester's credential or reprice a supplier's listing. I tested `deleteEntity`, `extendEntity` and `patchEntity` from a non-owner wallet and each fails with an error naming the owner.

Ownership is also the reason the app can trust the writer's identity without a login. The app checks that the entity's owner equals the address that signed the payload inside it.

## Expiry

| Entity | Expires | Why that fits |
|---|---|---|
| credential | at `validUntil` | an expired credential stops appearing to investors and other lenders; Whitechain independently refuses transfers to an expired credential |
| revocation | at a time the publisher chooses, at least 10 minutes out | the record only needs to outlive the credential it revokes |
| listing | due date + grace period + 1 hour | a note that can no longer be funded drops off the marketplace by itself |
| heartbeat | 600 seconds after it is written | silence is visible without anyone running a job to delete anything |

What a user sees because of expiry: a credential that was visible a minute ago is gone from the investor's panel when it lapses, and the transfer rule on Whitechain refuses at the same moment (the live test checks both). I added `extendEntity` for the supplier, who sees an "Extend the listing" button once a note is past its due date and still in funding. It adds an hour and keeps the listing visible while the debtor is in the grace period. In the heartbeat test an attester's heartbeat disappears on its own after its lifetime, and the desk switches from running to silent.

## Features I use and what each changes for the user

- `createEntity` with `ExpirationTime`: publishing a credential, a listing, a revocation or a heartbeat. The user sees "Credential published on Arkiv" or "Listed on Arkiv" and an explorer link to the entity's transaction.
- Typed schemas and the query builder: filters and sorting in the marketplace, and the credential lookup on the investor desk.
- `extendEntity`: the supplier's "Extend the listing" button.
- `patchEntity`: closing or updating a listing's status ("closed", "settled", "defaulted"). The supplier sees "Listing closed" and the investors stop seeing it as open.
- Key ordered paging (`$key` greater than the last key): looking through all credentials without missing or repeating any when a write lands between pages. The user sees a complete list; the cost of a missed page would be a credential that exists but is not offered.
- `watchEntityEvents`: the credentials and marketplace panels refresh within about a second of a new entity, without the user reloading.
- Reads over Anon-RPC: every Arkiv read goes through the Anon-RPC route (`arkivClients` requires an explicit transport, so no code path can read around it).

## What I considered and did not use

I did not store the invoice token, the IRN or the QR payload on Arkiv. They are public on chain only when the supplier chooses to bind the invoice, and I did not want a second, longer-lived public copy of them. I also did not use Arkiv's expiry as a security boundary, because it is block based and approximate (see `friction.md`).
