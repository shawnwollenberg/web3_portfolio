# WalletLens API

Paid API for normalized EVM wallet portfolio snapshots. The MVP uses Alchemy Portfolio APIs for token balances, prices, and recent activity, then gates `GET /portfolio` with x402 unless local dev bypass is enabled.

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

Portfolio request:

```bash
curl "http://localhost:3000/portfolio?address=0x0000000000000000000000000000000000000000&chains=base,ethereum"
```

Discovery:

```bash
curl http://localhost:3000/.well-known/x402.json
```

## Paid x402 Test

Use a dedicated test wallet. Do not use a high-value wallet or commit the private key.

Add this to `.env`:

```bash
X402_TEST_PRIVATE_KEY=0x...
X402_TEST_ADDRESS=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
X402_TEST_CHAINS=base,ethereum
X402_TEST_URL=https://walletlens.wallyweb.com/portfolio
```

The payer wallet needs Base USDC for the `$0.02` x402 payment.

Run:

```bash
npm run test:x402
```

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
- `GET /.well-known/x402.json`
- `GET /portfolio?address=...&chains=base,ethereum`

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
