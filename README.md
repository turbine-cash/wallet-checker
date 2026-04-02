# Wallet Checker

Browser-based Solana wallet auditor for two historical risk signals:

- SPL token delegation activity (`approve`, `approveChecked`, `revoke`)
- Durable nonce usage (`AdvanceNonceAccount` as the first top-level System Program instruction)

The app does not connect a wallet. Users paste:

- an RPC URL
- a wallet pubkey

If the RPC URL is recognized as Helius, the UI exposes two scan modes:

- `getSignaturesForAddress` + `getTransaction`
- `getTransactionsForAddress` with full parsed transactions

## What It Shows

- live scan activity with pages fetched, transactions scanned, retries, and request errors
- a hits-only results table
- one row per matching transaction with the signature, status, timestamp, badges, and a short finding summary

## Runtime Behavior

- Browser only: requests are sent directly from the client.
- No worker RPC proxy: the supplied RPC must allow browser-origin requests and CORS.
- Standard RPC mode scans newest-to-oldest signatures and hydrates each transaction with `jsonParsed`.
- Helius mode requests full parsed transactions directly with `getTransactionsForAddress`.

## Durable Nonce Rule

The checker flags durable nonce usage only when the first top-level instruction is a System Program nonce-advance instruction, matching Solana’s durable nonce detection flow.

Nonce-account setup transactions such as `InitializeNonceAccount` are intentionally not treated as durable nonce usage.

## Scripts

- `npm run dev`
- `npm run build`
- `npm run lint`
- `npm run test`

## Test Coverage

- parser fixtures for token delegation, inner revoke, durable nonce usage, and nonce-account setup
- mocked standard-RPC pagination and Helius full-page scans
- App-level tests for Helius mode enablement and rendering scan findings

The test suite includes the provided devnet nonce-account setup transaction signature:

- `skkfzUQrZF2rcmrhAQV6SuLa7Hj3jPFu7cfXAHvkVep3Lk3fNSVypwULhqMRinsa6Zj5xjj8zKZBQ1agMxwuABZ`

## Notes

- `npm run build` prints a `baseline-browser-mapping` freshness warning from the toolchain, but the build succeeds.
