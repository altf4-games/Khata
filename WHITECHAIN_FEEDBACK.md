# Whitechain feedback

From building Khata on Whitechain Sepolia (chain 1874) over about 24 hours: four contracts plus factory-made notes, a settlement flow with the prize USDT, and a lot of live testing. Dates are IST, 5 to 7 November 2026.

## What worked

- The chain itself was fast and predictable. Blocks come about once a second (I counted 21 blocks in 21 seconds), gas is about 5 gwei, and a full invoice lifecycle costs a few hundredths of a WBT. That is cheap enough to run live test suites all night.
- Heavy contract code runs fine. RSA-2048 verification through the modexp precompile cost 49.5k gas in a Foundry test, and a full `bindInvoice` (signature check, JSON parse, state writes) is about 1.12M gas on the live chain. I also deployed a 23.7 kB UltraHonk verifier at optimizer runs 1 and verified a zero-knowledge proof on-chain for about 3.1M gas.
- JSON-RPC batching works (`http(url, { batch: true })` in viem), and the WebSocket endpoint delivered `eth_subscribe` heads when I tried it.
- The prize USDT behaves like a normal 6 decimal token with EIP-2612 permit, so a one-transaction "approve and fund" works.
- The Uniswap V3 pool let me turn WBT into real USDT for the demo wallets (0.12 WBT became 8.82 USDT in one swap).
- Verification through `forge script --verify --verifier blockscout --verifier-url https://explorer.testnet.whitechain.io/api/` is the right path and takes a few seconds when the service is up. All four contracts are verified.

## Where I got stuck

### 1. Contract verification was unavailable for hours, and the status page said everything was fine

Expected: `forge script --verify` verifies the contracts, as it did on my first day.

Happened: from at least 15:00 on 6 November the Blockscout verifier would not verify anything. `forge` printed `Failed to deserialize response` because the body was `{"message":"Contract verification is temporarily unavailable."}`, not the Etherscan-style envelope it expects. I checked the cause:

```bash
curl -s https://explorer.testnet.whitechain.io/api/v2/smart-contracts/verification/config
# "is_rust_verifier_microservice_enabled": true, "solidity_compiler_versions": []
```

The explorer listed no Solidity compilers, so no verification could succeed. The status page (status.whitechain.io) showed the explorer, the explorer API and the RPC as operational with no reports in seven days. Verification worked again when I retried at around 21:00 the same day, and all four contracts verified in one run. I did not poll in between, so the real outage was somewhere in that window.

Suggestion: have the status check call the verification config endpoint and fail when the compiler list is empty. A line in the Foundry and Hardhat deployment guides saying what the outage symptom looks like would have saved me an hour of wondering whether my settings were wrong. This matters for hackathon prizes that require verified contracts.

### 2. `eth_getLogs` is capped at 10,000 blocks and the docs don't say so

Expected: a range query from my deployment block to latest.

Happened: `{"error":{"code":-32602,"message":"query exceeds max block range 10000"}}` with HTTP 200. A span of exactly 10,000 passes, 10,001 fails. At one block a second that is about 2.8 hours, so any app that reads events from its deploy block breaks the first day. Mine did: the note list loaded in the morning and showed "Could not read the chain" in the afternoon, and the first sign was a flaky browser test.

The code is -32602 (invalid params) rather than the -32005 many clients use for "range too large", so viem and ethers don't split the range for you. The batch limit (100) is documented in the rate-limit table and returns HTTP 413 as described. The log range cap is not in that table.

Repro:

```bash
curl -s https://rpc.testnet.whitechain.io -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getLogs","params":[{"fromBlock":"0x1","toBlock":"latest"}]}'
```

Fix on my side: read events in 9,000 block chunks and scan only new blocks after the first read (`eventsSince` in `web/src/notes.ts`), with a regression test. Suggestion: put the cap in the docs next to the batch limit.

### 3. The documented USDT address is not the prize token

Expected: the token list page names the USDT I should pay in.

Happened: `docs.whitechain.io/build/block-explorer/token-list.md` documents list version 1.1.0 (16 October) with USDT at `0xaa79…8f46`. The list served at `whitechain.io/tokens/whitechain.tokenlist.json` is version 3.0.0 (28 October) with USDT at `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`, which is the address on the Tokenize prize page. Calling `symbol()` on `0xaa79…` returns `USDT.e`. The bridge page (`build/bridge/portal-bridge.md`) also names `0xaa79…` as USDT. Someone following the docs pays in the bridged token, not the prize token. The served list also mixes chains 1874 and 1875 (for example, the list's "USDC.e" entry is on 1875), while the docs page presents six tokens on 1874.

Suggestion: regenerate the docs page from the served list, or link to the served list.

### 4. The prize USDT's permit domain can't be read from the contract

The prize USDT is an upgradeable proxy with EIP-2612 permit and EIP-3009 authorizations. It exposes `DOMAIN_SEPARATOR()` but has no `version()` and no `eip712Domain()`, so a client can't build a permit signature without already knowing the domain. I recovered it by hashing candidate names and versions until one matched the on-chain separator: name `Tether USD`, version `1`, chain 1874. It would help to publish that on the token's docs entry.

### 5. A reverting call for a wallet with too little gas money gives no reason

A wallet whose balance is below `gasLimit × maxFeePerGas` gets `The contract function "createNote" reverted` from `eth_call` with no reason data. It is not an "insufficient funds" error, and the real cost would have been far lower than the balance check requires. My live UI test hit this with 0.0046 WBT in the supplier wallet. The app now checks the balance when a simulation fails with no decoded error and says the wallet is out of WBT. Standard EVM behaviour, but a hint in the docs would help first-time deployers: contract creation limits are large, so keep a few hundredths of a WBT in the wallet.

### 6. Smaller things

- `eth_estimateGas` on a call that reverts fails client-side. To put a refusal on-chain for a demo you have to pass an explicit gas limit. Fine, just worth knowing.
- The Uniswap UniversalRouter's `V3_SWAP_EXACT_IN` takes six ABI arguments on this deployment (a trailing `uint256[]`). The five argument form reverts with `SliceOutOfBounds`. I only found the six argument form by trial.
- `forge script --verify` verifies contracts the script deploys directly. Contracts created by a factory need a separate `forge verify-contract` with ABI-encoded constructor arguments. I did this for one note and not for every note.
- The faucet gives 0.5 WBT per 24 hours with a GitHub account at least 30 days old. That is the real limit for a solo builder running live tests all night. The supplier wallet burned about 0.075 WBT per lifecycle plus zero-knowledge run.
- The docs' `coinsupply` example shows a 60 digit sentinel with an explanation; the live endpoint returns `0`.
- A request with the User-Agent `Python-urllib/3.12` gets an HTTP 403 `error code: 1010` from the RPC (a Cloudflare browser-signature rule). curl, python-requests, web3.py and node all pass. A plain urllib script fails with no hint.

## What I'd ask Whitechain to look at first

1. Make the status page notice an empty verifier compiler list.
2. Document the `eth_getLogs` range cap.
3. Regenerate the token list and bridge docs so the USDT address matches the token the prizes use.
