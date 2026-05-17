# WalletLens Agent Skill

Use this skill when an agent needs a normalized EVM wallet portfolio snapshot and can make x402 payments over HTTP.

## Service

- Name: WalletLens API
- Base URL: `https://walletlens.wallyweb.com`
- Paid endpoint: `GET /portfolio`
- Discovery: `GET /.well-known/x402.json`
- OpenAPI: `GET /openapi.json`
- Payment protocol: x402
- Payment network: Base mainnet, `eip155:8453`
- Price: `$0.02` USDC per portfolio call

## When To Use

Use WalletLens when the user asks for:

- Wallet portfolio balances
- Token holdings for an EVM address
- Multi-chain wallet snapshots
- Recent wallet activity summaries
- Agent-readable portfolio JSON

Do not use WalletLens for:

- Non-EVM wallets
- Solana wallets, until Solana support is explicitly added
- Historical PnL or tax reporting
- Trading execution

## Request

```text
GET https://walletlens.wallyweb.com/portfolio?address=<evmAddress>&chains=<chains>
```

Required query params:

- `address`: EVM address, `0x` plus 40 hex characters

Optional query params:

- `chains`: comma-separated list. Defaults to `base,ethereum`.

Supported chains:

- `base`
- `ethereum`
- `eth`
- `optimism`
- `arbitrum`
- `polygon`

## x402 Flow

1. Make the portfolio request.
2. If the response is HTTP `402`, read the `payment-required` response header.
3. Use an x402-capable client wallet to create the payment payload.
4. Retry the exact same request with the x402 payment header.
5. Parse the JSON response.

Unpaid test:

```bash
curl -i "https://walletlens.wallyweb.com/portfolio?address=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045&chains=base,ethereum"
```

## Response Shape

The paid response contains:

- `address`
- `timestamp`
- `chains`
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

