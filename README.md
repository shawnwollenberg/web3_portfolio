# WalletLens API

Paid API for EVM wallet intelligence: normalized portfolio snapshots, bundled wallet reports, and TxLens enriched transaction history. The app uses Alchemy APIs for token balances, prices, recent activity, and transfers, then gates paid endpoints with x402 unless local dev bypass is enabled.

## Secret Setup

Do not paste API keys into chat or commit them. Create a local `.env` from `.env.example`:

```bash
cp .env.example .env
```

Then fill in:

```bash
ALCHEMY_API_KEY=your_alchemy_key
MY_WALLET_ADDRESS=0xYourReceivingWallet
X402_DEV_BYPASS=true
```

Use `X402_DEV_BYPASS=true` locally. The AWS deployment defaults to `false` unless you override it.

## Local Development

```bash
npm run dev
```

Health check:

```bash
curl http://localhost:3000/health
```

Free cached live preview:

```bash
curl http://localhost:3000/preview
```

Free paid-call quote:

```bash
curl "http://localhost:3000/quote?address=0x0000000000000000000000000000000000000000&chains=base"
```

Portfolio request:

```bash
curl "http://localhost:3000/portfolio?address=0x0000000000000000000000000000000000000000&chains=base,ethereum"
```

TxLens history request:

```bash
curl "http://localhost:3000/tx-history?address=0x0000000000000000000000000000000000000000&chains=base&limit=20"
```

Bundled wallet report request:

```bash
curl "http://localhost:3000/wallet-report?address=0x0000000000000000000000000000000000000000&chains=base&limit=20"
```

Discovery:

```bash
curl http://localhost:3000/.well-known/x402.json
```

Verify that production returns Bazaar metadata and is indexed by Coinbase's
merchant and semantic discovery APIs:

```bash
npm run check:discovery
```

## Paid x402 Test

Use a dedicated test wallet. Do not use a high-value wallet or commit the private key.

Add this to `.env`:

```bash
X402_TEST_PRIVATE_KEY=0x...
X402_TEST_ENDPOINT=portfolio
X402_TEST_BASE_URL=https://walletlens.wallyweb.com
X402_TEST_ADDRESS=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
X402_TEST_CHAINS=base,ethereum
X402_TEST_LIMIT=20
X402_TEST_DAYS=30
X402_TEST_CATEGORY=all
```

The payer wallet needs Base USDC for the `$0.02` x402 payment.

Run:

```bash
npm run test:x402
```

Run a TxLens paid test:

```bash
npm run test:x402 -- --endpoint tx-history --address 0x52E29e0d2Aa49bfBfC548C0A9F2196F4aa51f3ea --chains base --limit 20
```

Run a bundled wallet report paid test:

```bash
npm run test:x402 -- --endpoint wallet-report --address 0x52E29e0d2Aa49bfBfC548C0A9F2196F4aa51f3ea --chains base --limit 20
```

## Analytics

WalletLens emits one privacy-conscious JSON analytics event per request to CloudWatch Logs. It records endpoint, status, latency, requested wallet, query parameters, hashed IP, user agent, response counts, and x402 settlement fields when available. It does not log private keys, x402 signatures, raw payment payloads, or full response bodies.

Summarize recent production usage:

```bash
npm run analytics:recent -- --hours 24
```

Optional flags:

```bash
npm run analytics:recent -- --hours 168 --profile wallyweb --region us-east-2
```

## MCP Server

WalletLens publishes a local stdio MCP server for Codex, Claude Desktop, Cursor,
and other MCP-compatible agent clients:

```text
https://www.npmjs.com/package/@shawnwollenberg/walletlens-mcp
```

Run the published package without cloning this repository:

```bash
npx --yes @shawnwollenberg/walletlens-mcp@0.1.0
```

Repository contributors can run the same server from source with `npm run mcp`.
Free discovery tools require no wallet. For paid calls, set a dedicated,
low-balance agent wallet in the MCP server environment:

```bash
WALLETLENS_X402_PRIVATE_KEY=0x...
```

The MCP client defaults to a maximum payment of `$0.02` and accepts only exact
Base-mainnet USDC requirements for the requested WalletLens endpoint. It also
pins the live WalletLens recipient by default:

```bash
WALLETLENS_MAX_PAYMENT_USDC=0.02
WALLETLENS_EXPECTED_PAY_TO=0xA7c82E9775A9594c673E3Fde8a42D3D17dE2B957
WALLETLENS_REQUEST_TIMEOUT_MS=20000
```

Example MCP client configuration:

```json
{
  "mcpServers": {
    "walletlens": {
      "command": "npx",
      "args": ["--yes", "@shawnwollenberg/walletlens-mcp@0.1.0"],
      "env": {
        "WALLETLENS_X402_PRIVATE_KEY": "0xYOUR_DEDICATED_AGENT_PRIVATE_KEY",
        "WALLETLENS_MAX_PAYMENT_USDC": "0.02",
        "WALLETLENS_EXPECTED_PAY_TO": "0xA7c82E9775A9594c673E3Fde8a42D3D17dE2B957"
      }
    }
  }
}
```

Available tools:

- `get_service_metadata`
- `get_supported_chains`
- `get_openapi_schema`
- `get_portfolio`
- `get_tx_history`
- `get_wallet_report`

## AWS Deployment

This project deploys an AWS Lambda Function URL with CDK. It uses the `wallyweb` AWS profile by default in the npm script.

Set `.env` for production before deploying:

```bash
ALCHEMY_API_KEY=your_alchemy_key
MY_WALLET_ADDRESS=0xYourReceivingWallet
X402_DEV_BYPASS=false
X402_PRICE_USD=0.02
X402_NETWORK=eip155:8453
X402_FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402
CDP_API_KEY_ID=your_cdp_key_id
CDP_API_KEY_SECRET=your_cdp_key_secret
ROOT_DOMAIN=wallyweb.com
CUSTOM_DOMAIN=walletlens.wallyweb.com
PUBLIC_BASE_URL=https://walletlens.wallyweb.com
ANALYTICS_IP_SALT=random-long-string
PROVIDER_TIMEOUT_MS=10000
```

Bootstrap CDK once per account/region if needed:

```bash
npm run cdk -- bootstrap --profile wallyweb
```

Deploy:

```bash
npm run deploy:aws
```

The deploy output includes `PortfolioApiUrl`. Use that base URL for:

- `GET /health`
- `GET /status`
- `GET /preview`
- `GET /quote?address=...&chains=base`
- `GET /pricing`
- `GET /examples`
- `GET /.well-known/x402.json`
- `GET /portfolio?address=...&chains=base,ethereum`
- `GET /tx-history?address=...&chains=base&limit=20`
- `GET /wallet-report?address=...&chains=base&limit=20`

The public production URL is:

```text
https://walletlens.wallyweb.com
```

## Supported Chains

Initial EVM support:

- `base`
- `ethereum` or `eth`
- `optimism`
- `arbitrum`
- `polygon`

Solana is intentionally out of scope for the first version.
