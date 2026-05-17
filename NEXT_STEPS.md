# WalletLens Next Steps

## Goal

Make WalletLens easier for autonomous agents to discover, evaluate, pay for, and reuse.

## Priority 1: Agent Discovery

- Add x402 Bazaar metadata to the paid `/portfolio` route.
- Keep `llms.txt`, `llms-full.txt`, `openapi.json`, and the agent skill current.
- Trigger at least one successful x402 settlement so CDP Bazaar can catalog the route.
- Add public examples that show unpaid 402 negotiation and paid x402 client calls.

## Priority 2: MCP Access

- Provide a local stdio MCP server for agent clients.
- Expose tools for service metadata, pricing, supported chains, schema, and paid portfolio calls.
- Document how to configure the MCP server in agent clients.
- Later, consider a hosted MCP transport if there is demand.

## Priority 3: Higher-Value Portfolio Output

- Add `summary.totalValueUsd`.
- Add per-chain totals.
- Add top holdings.
- Add stablecoin totals.
- Track missing price counts and warnings.
- Add data freshness metadata.

## Priority 4: Trust And Launch

- Publish a concrete launch post with URLs and example calls.
- Add `/pricing`, `/examples`, and `/status` pages or endpoints.
- Add uptime and version metadata.
- Move deployment secrets from Lambda environment variables into AWS Secrets Manager.

## Priority 5: Product Expansion

- Add a free preview endpoint.
- Add batch wallet lookups.
- Add `/tx-history`.
- Add risk flags and entity labels.
- Add Solana support after EVM usage is validated.

