# Why Arkiv

## If I swapped Arkiv for Postgres, what would users lose?

The data Khata puts on Arkiv is data that several parties need to read and none of them should have to ask me for.

An attester signs "this wallet may hold notes" and publishes it. A second lender who has never heard of Khata can read that credential and check it with nothing but the public schema, the AttesterRegistry address and an RPC. I ran exactly that: `npx tsx scripts/second-issuer.ts <wallet>` accepted an investor from the attester's Arkiv credentials alone, with no code from the app beyond the public schema. With Postgres, that lender would need an API from me, an account, and trust that my server shows them what the attester published and hides nothing. If my server goes down, the credential registry goes with it.

Three more things would change:

- Ownership without a login. Each entity belongs to the wallet that wrote it, and Arkiv rejects edits from anyone else. A credential is owned by the attester, a listing by the supplier. With Postgres, I would be the one holding those write permissions, and a reader would have to believe my access control. Here a reader checks the owner field themselves.
- Expiry that does the cleanup. A credential, a listing and an attester heartbeat all stop existing when they should. The attester desk's "running or silent" status needs no job and no "last seen" column that someone has to trust: a heartbeat entity lives for 600 seconds, and if none is found the attester is silent.
- Listings that nobody can quietly rewrite. A supplier's marketplace entry is written by the supplier's own wallet, so another supplier cannot edit it, and in a real deployment I could not either. In this demo the five wallets are demo wallets whose keys sit in my signer, so I could; the ownership rule itself is Arkiv's and holds for any wallet. The app also checks every listing against the factory on Whitechain, so a fake listing for someone else's note is dropped.

Users would not lose a feature I couldn't build on a database. They would lose the guarantee that the marketplace and the credentials are public data with public owners, which any other app can read and verify without my permission.

## What did I keep off Arkiv, and why?

| Kept off Arkiv | Where it lives | Why |
|---|---|---|
| The invoice QR payload, the IRN and the signature check | Whitechain (registry) | The check has to be enforced by a contract. Whitechain contracts cannot read Arkiv, so anything a contract must trust cannot come only from Arkiv. |
| Notes, balances, funding, settlement and redemption | Whitechain (note contract) and the prize USDT | Money and the transfer rule need atomicity: payment and delivery in one transaction. |
| The final say on a credential | Whitechain (AttesterRegistry) | The attester's signature, expiry and revocation are checked again by the contract when notes move. Arkiv expiry is block based and approximate, so it is not used as a security boundary. |
| Revocation authority | Whitechain | Deleting an Arkiv entity does not reach Whitechain. A revocation is an attester-signed message anyone can submit to the AttesterRegistry. The same message is also published on Arkiv so other lenders see it. |
| Demo wallet keys and the demo invoice signing key | The server-side signer | Secrets do not belong in any public store. |
| Anything private about the invoice | Not stored anywhere by the app | Putting the token or the IRN on Arkiv would create a second, longer-lived public copy of data the supplier only chose to expose on binding. |

Because of this split, if Arkiv were unavailable the note rules would still hold: transfers are checked against credentials registered on Whitechain, and settlement and redemption do not touch Arkiv. What breaks is discovery. An investor cannot find a listing or a ready credential. The app says so ("Arkiv did not answer in time. Whitechain still works") and keeps working with the credentials already registered on chain.

## What Arkiv does not give me

Arkiv cannot be read by contracts, so I carry an attester signature on every credential and check it on Whitechain. I would trade that for a way to read Arkiv state from the chain, but I would not trade the ownership and expiry model for a database.
