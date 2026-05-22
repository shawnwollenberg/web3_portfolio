# WalletLens Agent Skill

Use this skill when an agent needs EVM wallet intelligence, a normalized portfolio snapshot, a bundled wallet report, or enriched transaction history and can make x402 payments over HTTP.

## Service

- Name: WalletLens API
- Base URL: `https://walletlens.wallyweb.com`
- Paid endpoints: `GET /portfolio`, `GET /tx-history`, `GET /wallet-report`
- Agent discovery: `GET /discover`
- Free preview: `GET /preview`
- Status/resource index: `GET /status`
- Discovery: `GET /.well-known/x402.json` or `GET /.well-known/x402`
- OpenAPI: `GET /openapi.json`
- Examples: `GET /examples?format=json`
- Local MCP server: `npm run mcp`
- Payment protocol: x402
- Payment network: Base mainnet, `eip155:8453`
- Price: `$0.02` USDC per paid call

## When To Use

Use WalletLens when the user asks for:

- Wallet portfolio balances
- Token holdings for an EVM address
- Multi-chain wallet snapshots
- Bundled wallet reports with holdings and recent activity
- Enriched transaction history
- Base wallet lookup
- USDC transfer history
- Recent wallet activity summaries
- Agent-readable portfolio JSON

Do not use WalletLens for:

- Non-EVM wallets
- Solana wallets, until Solana support is explicitly added
- Historical PnL or tax reporting
- Trading execution

## Request

Before paying, inspect the free cached live preview:

```text
GET https://walletlens.wallyweb.com/discover
GET https://walletlens.wallyweb.com/quote?address=<evmAddress>&chains=<chains>
GET https://walletlens.wallyweb.com/preview
```

Use `/discover` to find capabilities and examples. Use `/quote` to validate the address and inspect price before payment. Use the preview to confirm the response shape. It is limited to the configured demo wallet and returns compact token/activity arrays. Use the paid endpoint when live data for an arbitrary wallet or full output is needed.

```text
GET https://walletlens.wallyweb.com/portfolio?address=<evmAddress>&chains=<chains>
GET https://walletlens.wallyweb.com/tx-history?address=<evmAddress>&chains=<chains>&limit=<limit>
GET https://walletlens.wallyweb.com/wallet-report?address=<evmAddress>&chains=<chains>&limit=<limit>
```

Required query params:

- `address`: EVM address, `0x` plus 40 hex characters

Optional query params:

- `chains`: comma-separated list. Defaults to `base,ethereum`.
- For `tx-history` and `wallet-report`: `limit`, `days`, and `category` are also accepted.

Supported chains:

- `base`
- `ethereum`
- `eth`
- `optimism`
- `arbitrum`
- `polygon`

## x402 Flow

1. Make the portfolio, transaction history, or wallet report request.
2. If the response is HTTP `402`, read the `payment-required` response header.
3. Use an x402-capable client wallet to create the payment payload.
4. Retry the exact same request with the x402 payment header.
5. Parse the JSON response.

Unpaid test:

```bash
curl "https://walletlens.wallyweb.com/quote?address=0x52E29e0d2Aa49bfBfC548C0A9F2196F4aa51f3ea&chains=base"
curl https://walletlens.wallyweb.com/discover
curl -i "https://walletlens.wallyweb.com/portfolio?address=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045&chains=base,ethereum"
curl -i "https://walletlens.wallyweb.com/tx-history?address=0x52E29e0d2Aa49bfBfC548C0A9F2196F4aa51f3ea&chains=base&limit=20"
curl -i "https://walletlens.wallyweb.com/wallet-report?address=0x52E29e0d2Aa49bfBfC548C0A9F2196F4aa51f3ea&chains=base&limit=20"
```

## Response Shape

The paid response contains:

- `address`
- `timestamp`
- `chains`
- `summary`
- `tokens`
- `positions`
- `recentActivity`
- `provider`

Token objects contain:

- `chain`
- `chainId`
- `contract`
- `symbol`
- `name`
- `decimals`
- `logo`
- `rawBalance`
- `balance`
- `priceUsd`
- `valueUsd`

Summary contains:

- `totalValueUsd`
- `pricedTokenCount`
- `unpricedTokenCount`
- `tokenCount`
- `stablecoinValueUsd`
- `chains`
- `topHoldings`
- `warnings`

TxLens transaction history contains:

- `summary.transactionCount`
- direction counts
- action counts
- per-chain counts
- normalized `transactions`
- `pagination.pageKeys`

Wallet report contains:

- `summary.totalValueUsd`
- `summary.topHoldings`
- `summary.transactionCount`
- `summary.transactionDirections`
- `summary.transactionActions`
- full `portfolio`
- full `txHistory`

Transaction objects contain:

- `chain`
- `chainId`
- `hash`
- `timestamp`
- `from`
- `to`
- `counterparty`
- `direction`
- `category`
- `type`
- `protocol`
- `asset`
- `value`
- `decoded`
- `labels`
- `riskFlags`

## Error Handling

- HTTP `400`: invalid address or unsupported chain
- HTTP `402`: payment required
- HTTP `500`: provider or server error

For HTTP `402`, do not treat the response as a hard failure. It is the expected x402 payment negotiation step.

## Example User-Facing Summary

After a successful paid request, summarize:

- Total visible token count
- Chains included
- Largest token values when `valueUsd` is available
- Any missing pricing data
- Recent activity count

Avoid overstating completeness. WalletLens depends on provider coverage and currently focuses on EVM chains.
