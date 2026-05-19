# WalletLens Next Steps

## Goal

Make WalletLens easier for autonomous agents to discover, evaluate, pay for, and reuse.

## Priority 1: Agent Discovery

- [x] Add x402 Bazaar metadata to the paid `/portfolio` route.
- [x] Add x402 Bazaar metadata to the paid `/tx-history` route.
- [x] Add search-intent rich descriptions for portfolio, transaction history, and wallet report use cases.
- [x] Keep `llms.txt`, `llms-full.txt`, `openapi.json`, and the agent skill current.
- Trigger successful x402 settlements from 3-5 distinct payer wallets for `/portfolio`, `/tx-history`, and `/wallet-report`.
- [x] Add public examples that show unpaid 402 negotiation and paid x402 client calls.
- Add a public agent use-cases page or JSON endpoint with common search phrases.
- Publish WalletLens in x402, CDP, Base, Farcaster, X, and agent-builder channels.

## Priority 2: MCP Access

- [x] Provide a local stdio MCP server for agent clients.
- [x] Expose tools for service metadata, pricing, supported chains, schema, and paid portfolio calls.
- [x] Document how to configure the MCP server in agent clients.
- Later, consider a hosted MCP transport if there is demand.

## Priority 3: Higher-Value Portfolio Output

- [x] Add `summary.totalValueUsd`.
- [x] Add per-chain totals.
- [x] Add top holdings.
- [x] Add stablecoin totals.
- [x] Track missing price counts and warnings.
- Add data freshness metadata.

## Priority 4: Trust And Launch

- Publish a concrete launch post with URLs and example calls.
- Publish a short "how agents should use WalletLens" post with the x402 discovery URL.
- [x] Add `/pricing`, `/examples`, and `/status` pages or endpoints.
- Add uptime and version metadata.
- Move deployment secrets from Lambda environment variables into AWS Secrets Manager.

## Priority 5: Product Expansion

- [x] Add a free preview endpoint.
- [x] Add a bundled paid `/wallet-report` endpoint for portfolio plus transaction history.
- Add a cheaper paid `/wallet-summary` discovery endpoint if paid traffic remains low.
- Add batch wallet lookups.
- [x] Add `/tx-history`.
- [x] Add basic risk flags and entity labels.
- Add Solana support after EVM usage is validated.
