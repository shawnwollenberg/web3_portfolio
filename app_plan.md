# Web3 x402 Portfolio API Plan

## Goal

Create a paid API endpoint that returns a clean, normalized wallet portfolio snapshot across chains.

The MVP should return:

- Token balances
- Native balances
- DeFi positions, if available through the selected data provider
- Recent wallet activity
- Normalized chain, token, and balance metadata

The endpoint should charge a small USDC payment per call through x402 and expose discovery metadata so agents and clients can find the paid resource.

## MVP Offer

- **Endpoint:** `GET /portfolio`
- **Input:** wallet address and optional chain list
- **Price:** `$0.01` to `$0.05` USDC per request
- **Initial target price:** `$0.02` USDC per request
- **Payment protocol:** x402
- **Initial payment network:** Base
- **Data provider:** Alchemy first, QuickNode as fallback if Alchemy coverage is insufficient
- **Deployment target:** Railway, Render, Vercel, or Cloudflare Workers
- **Target build time:** 2 to 4 hours for a minimal public MVP

## Core Value

Use an existing web3 data provider for the heavy lifting, then add value through normalization and response quality.

The service should focus on:

- Consistent response shape across chains
- Human-readable token metadata
- Decimal-adjusted balances
- Chain identifiers and labels
- Recent activity summaries
- Optional risk, tagging, or smart-money signals in later iterations

## Proposed Stack

### Runtime

- Node.js
- Express for the first version
- Hono as an optional alternative if deploying to Cloudflare Workers

### Dependencies

```bash
npm init -y
npm install express dotenv @x402/express @x402/core alchemy-sdk
```

### Environment Variables

```bash
ALCHEMY_API_KEY=your_alchemy_key_here
MY_WALLET_ADDRESS=0xYourReceivingWalletHere
PORT=3000

# Optional, depending on facilitator setup
CDP_API_KEY=your_cdp_key_if_required
```

## Planned API Surface

### `GET /portfolio`

Returns a paid wallet portfolio snapshot.

Example query:

```text
/portfolio?address=0xabc...&chains=base,ethereum
```

Expected MVP response shape:

```json
{
  "address": "0xabc...",
  "timestamp": "2026-05-17T00:00:00.000Z",
  "chains": ["base", "ethereum"],
  "tokens": [
    {
      "chain": "base",
      "contract": "0x...",
      "symbol": "USDC",
      "name": "USD Coin",
      "decimals": 6,
      "rawBalance": "1000000",
      "balance": "1.0",
      "priceUsd": "1.00",
      "valueUsd": "1.00"
    }
  ],
  "positions": [],
  "recentActivity": [],
  "provider": "alchemy"
}
```

### `GET /.well-known/x402.json`

Returns discovery metadata for paid clients and agents.

Expected response shape:

```json
{
  "version": "1",
  "resources": [
    {
      "path": "/portfolio",
      "method": "GET",
      "price": "$0.02",
      "description": "Multi-chain wallet portfolio snapshot with normalized tokens and positions"
    }
  ]
}
```

## Implementation Plan

### 1. Project Setup

Create the Node project and baseline server.

```bash
mkdir web3-x402-portfolio
cd web3-x402-portfolio
npm init -y
npm install express dotenv @x402/express @x402/core alchemy-sdk
```

Create:

- `.env`
- `.gitignore`
- `index.js`
- `README.md`

### 2. x402 Payment Gate

Add x402 middleware around the paid endpoint.

Initial payment configuration:

- `scheme`: `exact`
- `price`: `$0.02`
- `network`: Base
- `payTo`: receiving wallet from `MY_WALLET_ADDRESS`
- `description`: portfolio snapshot API

Before implementation, verify the current x402 Express package API and facilitator configuration against the official docs/examples.

### 3. Portfolio Data Fetching

Start with Alchemy for:

- Token balances
- Token metadata
- Native balances, if supported by the selected API
- Recent transfers/activity
- Multi-chain support through Portfolio APIs where available

The current rough sample uses `alchemy.core.getTokenBalances(address)`, but the final build should prefer Alchemy Portfolio APIs if they provide the required multi-chain response in fewer calls.

### 4. Normalization Layer

Transform provider-specific responses into one stable API contract.

Normalize:

- Chain IDs and chain names
- Contract addresses
- Token symbols and names
- Decimals
- Raw balances
- Decimal-adjusted balances
- USD prices and values, where available
- Activity timestamps, transaction hashes, and event types

### 5. Error Handling

Return predictable errors for:

- Missing `address`
- Invalid wallet address
- Unsupported chain
- Provider failure
- Rate limit or quota failure
- Payment/facilitator failure

### 6. Local Testing

Run locally:

```bash
node index.js
```

Test cases:

- Request without payment should return HTTP `402`
- Paid/retried request should return portfolio data
- Missing address should return HTTP `400`
- Invalid address should return HTTP `400`
- Discovery endpoint should return JSON metadata

### 7. Deployment

Fastest options:

- Railway
- Render
- Vercel

Cloudflare Workers is attractive for edge deployment, but it may be cleaner with Hono instead of Express.

Deployment checklist:

- Push project to GitHub
- Connect deployment provider
- Add environment variables
- Confirm public URL
- Confirm `/.well-known/x402.json`
- Confirm paid `/portfolio` flow

## Launch Plan

After deployment:

- List the endpoint in x402 discovery venues such as x402 Bazaar or x402scan, if appropriate
- Share the public API URL
- Publish a short post announcing the paid portfolio endpoint
- Track first paid request as validation

Example positioning:

```text
New x402 Web3 Portfolio API: normalized multi-chain wallet snapshots for $0.02 USDC per call. Built for agents and automated portfolio workflows.
```

## Follow-Up Enhancements

- `GET /tx-history`
- Batch wallet lookups
- Risk scoring
- MEV or suspicious-activity signals
- Entity labels
- Smart-money tagging
- OpenAPI spec
- Solana support
- Tiered pricing for richer responses
- Caching for repeated requests
- Rate limiting by payer or client

## Success Metrics

- First paid call validates payment and discovery
- 100 calls/day at `$0.02` equals `$2/day`
- Higher-value enrichment can justify `$0.05+` per call

## References

- x402 official site: https://www.x402.org/
- x402 GitHub examples: https://github.com/x402-foundation/x402/tree/main/examples
- Alchemy Portfolio APIs: https://www.alchemy.com/docs/reference/portfolio-apis

## Build Questions

Before starting implementation, answer these:

1. Should the project be built directly in this repository, or should I create the nested `web3-x402-portfolio` folder from the original plan?
2. Which deployment target do you prefer for the MVP: Railway, Render, Vercel, or Cloudflare Workers?
3. Do you already have an Alchemy API key and receiving wallet address, or should I wire the app with placeholder `.env.example` values only?
4. Should the MVP support only EVM chains first, or should Solana be included from day one?
5. Should unpaid local development bypass x402 behind a dev flag, or should every `/portfolio` request require the payment flow even locally?
6. Do you want TypeScript for stronger API contracts, or plain JavaScript for the fastest first build?
