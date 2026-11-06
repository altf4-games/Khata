# Arkiv friction

What got in my way while building on Rabdi (chain 7794095) with `@arkiv-network/sdk` 1.0.1, 5 to 6 November 2026. Each item says what I expected, what happened, and how to reproduce it. I reproduced items 1 to 5 on the public endpoint on 6 November.

## 1. `NOT` is recommended by an error message but the node answers `NotImplemented`

Expected: `NOT (attr = value)`, which the `!=` error tells you to write, works.

Happened: the node returns `-32603` with `query: store: NotImplemented`.

```bash
curl -s https://rpc.rabdi.db-chain.testnet.arkiv.network -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":["NOT (foo = str('"'"'x'"'"'))",{"limit":1}]}'
# {"error":{"code":-32603,"message":"query: store: NotImplemented"}}

# the != form points you at it:
#   "foo != str('x')"  ->  -32002  "!= is not part of the query language — write NOT (attr = value) for the complement"
```

The docs' query language reference lists `NOT` as a reserved keyword, and `llms.txt` lists `ne` and `not` as filter helpers. `@arkiv-network/sdk/query` in 1.0.1 exports neither (`and`, `asc`, `between`, `desc`, `eq`, `gt`, `gte`, `hasType`, `lt`, `lte`, `or`, `startsWith` and a few more). `-32603` is also an internal error code, while the docs describe query mistakes as `QueryError` kinds. I worked around it by filtering on positive values (a status of `open`, a `validUntil` greater than now).

## 2. The node accepts `*`, the SDK says there is no way to match everything

Expected: one way to say "all entities" in both places.

Happened: `arkiv_query` with `*` returns rows, and the empty query error says to write `*`. But `select().from(Schema)` without a `where` throws `InvalidPredicateError` ("the language has no spelling for 'match every entity'"). I needed a placeholder filter (`$key > 0x00…00`) to page through everything, which is what `scripts/arkiv-reach.ts` does.

Related: the node also supports `select: { count: true }` and `client.count()` ships in 1.0.1, but the "add count" SDK issue (#110) is still open.

## 3. Cursor paging fails as soon as a block passes

Expected: the `cursor` returned with a page continues that query.

Happened: with the public endpoint, a second page requested a few seconds after the first fails.

```bash
# page 1:  "*" with {"limit":2,"select":{"key":true}}   -> result with a cursor at block B
# wait 4 seconds, then page 2 with the same query and that cursor:
#   -> -32005  "cursor belongs to a different query, block or select — start a new page-through"
# page 2 again, adding "atBlock": B:
#   -> -32006  "block B is unavailable: state for this block is not retained"
```

Only the head block was queryable (`atBlock` at the tip worked about two times in three; older blocks always failed in my tries). This means pinning `atBlock` inside `next()`, the fix suggested in the open cursor issue (#125), would not help on the public endpoint. I tested without an access key and did not test with one. I page by key instead: sort by `$key`, and continue after the last key of the previous page (`findAllCredentials` in `web/src/arkiv.ts`), with a test where a write lands between pages. `llms.txt` still lists `cursor`, `atBlock` and `next` under Paginate.

## 4. An unfunded wallet's first write fails with a message that points nowhere

Expected: "this wallet has no tGLM".

Happened: `createEntity` throws `Transaction failed: Execution error without revert data` at the top level. The real reason (`exceeds the balance of the account`) is three causes down. A first-time user would think the contract call is wrong. My helper `arkivError` searches the whole cause chain.

## 5. A rate-limited response doesn't say it is rate limited

Expected: an error that names the rate limit.

Happened: a 429 reaches the app as `HttpRequestError: HTTP request failed.`, and the status sits only in a `status` property on a nested error. My first rate-limit test failed because I matched on the message text. This is viem's error shape surfaced through the SDK. Mapping it is a few lines (`arkivError` reads `status` and `details` from every error in the chain), but a typed error from the SDK would save everyone writing it. The same area has an open issue about a long hang under rate limiting (#126).

## 6. Node version

The SDK README and the "first entity" doc say Node 22.10+. The package declares `>=18`, and reads, writes and the query builder all worked here on Node 20.20.2. One of them is wrong, or 22.10 is needed for the TypeScript-running examples only; either way it is worth saying which.

## 7. `bytes` columns come back as `0x` strings

Expected: a `Uint8Array`, which is what I put in.

Happened: a hex string. I ran `bytesToHex` over the string and garbled the signature, so my first live round trip failed with "malformed". The docs example does use `hexToString(row.body.value)`, so this is documented; it is still an easy mistake when the write side takes bytes. Caught by the round-trip test, fixed in `hexOf`.

## 8. Dynamic filters need a cast

`where()` is checked against the schema at compile time, which I like. Building a predicate from optional filters (status, minimum discount, due before) is awkward because the array of predicates doesn't satisfy the typing. I kept one cast in one helper (`pred` in `web/src/arkiv.ts`). A way to compose optional predicates with types intact would help.

## 9. Expiry is block based, so it is approximate

A credential with `validUntil` 30 seconds out was queryable and then gone within my 120 second window, as documented. Because expiry follows blocks, I kept the authoritative expiry in the signed credential that Whitechain checks and used Arkiv's expiry for discovery only. Say this near `ExpirationTime` in the docs so nobody uses the entity expiry as a security boundary.

## 10. Attribute name casing

Issue #128 reports mixed-case attribute names rejected. On Rabdi, queries with `Foo`, `FOO_Bar`, `foo.bar` and `foo-bar` are accepted, which matches the schema docs ("case-sensitive, mixed case fine"), and an existing entity carries the attribute `contentType`. Leading underscores and non-ASCII characters are rejected ("unexpected character"), and names over 32 bytes are rejected ("attribute names are limited to 32 bytes"). I did not write a mixed-case attribute to test the create side, so the issue may still be Tiramisu-only.

## What worked well

- Writes and reads worked on the first try once the faucet had funded the wallets. A write costs about 0.0001 tGLM, so 1 tGLM from the faucet is thousands of writes.
- Ownership is enforced on every mutation, not only delete. A non-owner's `deleteEntity`, `extendEntity` and `patchEntity` each fail with a clear message naming the owner. I had assumed extend was open to anyone and the live test corrected me.
- `defineSchema` with typed columns, and a `where()` checked against the schema, caught mistakes before running.
- `watchEntityEvents` delivered a new entity as an event without polling, and the app uses it to refresh the credentials and marketplace panels.
- Expiry works as documented. I used it for credentials, listings and a heartbeat that disappears when the attester stops.
- Reads work through Anon-RPC: `http(url, { fetchFn: worker.fetch })` is enough for the SDK to send its queries through Tor or Nym.

## What I'd add

1. A typed `QueryError` for every query failure, including `NotImplemented`.
2. One documented way to match all entities in the builder.
3. A typed rate-limit error from the SDK.
4. Cursor paging that survives a new block, or clear docs that it can't and a key-paging recipe in its place.
