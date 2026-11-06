# Arkiv schema

Khata writes four entity types to the Arkiv Rabdi testnet (chain 7794095) with `@arkiv-network/sdk` 1.0.1. The definitions are in `web/src/arkiv.ts` (`defineSchema`). Every entity carries the attribute `arkiv.schema` set to its type name, and every field below marked "indexed" is one the app filters or sorts on.

Nothing read from Arkiv is trusted on its own. The app checks each credential's signature against the entity's owner, and each listing against the factory contract on Whitechain. Whitechain contracts cannot read Arkiv, so Arkiv carries discovery and Whitechain carries enforcement.

## khata.credential

An attester's statement that a wallet may hold notes, signed with EIP-712.

| Field | Type | Indexed | Meaning |
|---|---|---|---|
| subject | addr | yes | the investor wallet the credential is for |
| attester | addr | yes | the signer; must equal the entity owner |
| tier | u64 | yes | credential level; a note has a minimum tier |
| validUntil | u64 | yes | unix seconds, the same value the attester signed |
| credId | str | yes | `0x` plus 64 hex characters, the id the attester signed |
| jurisdiction | u64 | no | signed, not queried |
| signature | bytes | no | 65 byte EIP-712 signature |

Owner: the attester wallet. Only the owner can update, extend or delete it; a non-owner's attempt fails with `entity 0x… is owned by 0x…, not 0x…` (tested for delete, extend and patch).

Expires: at `validUntil` (`ExpirationTime.atDate`, with a floor of 10 seconds). Arkiv expiry is block based and approximate, so the authoritative expiry is the signed `validUntil` that Whitechain checks. Arkiv's expiry keeps the discovery list clean.

Queried by: `subject` (an investor's own credentials), `attester`, and `validUntil` greater than now (so expired ones never appear), ordered by `validUntil`. A page-through of all credentials uses `$key` ordering.

## khata.revocation

An attester's signed statement that one credential no longer counts.

| Field | Type | Indexed | Meaning |
|---|---|---|---|
| attester | addr | yes | the signer |
| credId | str | yes | the credential being revoked |
| signature | bytes | no | EIP-712 signature |

Owner: the attester wallet. Expires: `keepUntil`, set by the publisher, at least 10 minutes out. Queried by `attester` and `credId`. A revocation only counts when its signature recovers to the attester it names; deleting the Arkiv entity alone does not reach Whitechain, which is why the same message can be submitted to the AttesterRegistry by anyone.

## khata.listing

A supplier's marketplace entry for a note.

| Field | Type | Indexed | Meaning |
|---|---|---|---|
| note | addr | yes | the note contract |
| seller | addr | yes | the supplier wallet; must equal the entity owner |
| nullifier | str | yes | the invoice's nullifier; the factory must map it to this note |
| faceValue | u64 | yes | micro-USDT |
| discountBps | u64 | yes | discount in basis points |
| dueDate | u64 | yes | unix seconds |
| minTier | u64 | yes | minimum credential tier to hold the note |
| status | str | yes | `open`, `closed`, `settled` or `defaulted` |
| title | str | no | display name |

Owner: the supplier wallet. Expires: due date plus the note's grace period plus one hour, so a listing disappears when it can no longer be funded. The supplier can extend it (`extendEntity`), and the app offers that once a note is past due and still in funding.

Queried by: `status`, `dueDate` greater than now, `seller`, `discountBps` at or above a floor, `dueDate` at or below a limit; sorted by `dueDate` or by `discountBps`. A listing is shown only if the factory on Whitechain confirms that this note was created for that nullifier and that the seller is the note's seller. For "open", the chain has the last word: a note that is settled, defaulted or closed on Whitechain is not shown as open even if the seller never updated the listing.

## khata.heartbeat

Written by an attester while it is running.

| Field | Type | Indexed | Meaning |
|---|---|---|---|
| attester | addr | yes | the signer |
| seq | u64 | yes | unix seconds when it was sent |

Owner: the attester wallet. Expires: 600 seconds after it is written. If the attester stops, its last heartbeat expires and the attester desk shows it as silent. Queried by `attester`, newest `seq` first, limit 5.

## What is not on Arkiv

The invoice QR payload, the IRN, the signature check, the note, the balances, the revocation authority and all money. They live on Whitechain (see `why-arkiv.md`).

## Wallets that wrote entities

| Wallet | Address | Writes |
|---|---|---|
| Attester (demo) | `0xB288ae1aaAeB761520D4A72bb87DbB6ef11126Db` | credentials, revocations, heartbeats |
| Supplier (demo) | `0xa03d3c24469DD58EAE3AE230781f293850A7686b` | listings |

The live tests also use a throwaway "rogue" wallet to try, and fail, to change entities it does not own. Test runs left a few test listings on the supplier wallet, so some live entities are test data.

## A query you can run

```bash
curl -s https://rpc.rabdi.db-chain.testnet.arkiv.network -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":["seller = addr(0xa03d3c24469DD58EAE3AE230781f293850A7686b)",{"limit":5,"select":{"key":true,"owner":true,"attributes":true}}]}'
```

Hex numbers come back as u64 hex strings (`discountBps` `0x1f4` is 500). To list one type, use `arkiv.schema = str('khata.credential')`. To count everything Khata holds, by type and by writer, run `npx tsx scripts/arkiv-reach.ts`.
