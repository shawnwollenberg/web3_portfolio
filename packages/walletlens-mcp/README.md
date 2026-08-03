# WalletLens MCP

WalletLens MCP gives MCP-compatible agents access to free service discovery and paid EVM wallet intelligence, including Robinhood Stock Token reports, through x402.

The server runs locally over stdio. Paid requests are signed locally with a dedicated agent wallet; WalletLens never receives the private key.

## Available tools

- `get_service_metadata` — free live pricing, documentation, and service metadata
- `get_supported_chains` — free supported-chain metadata
- `get_openapi_schema` — free OpenAPI schema
- `get_portfolio` — paid portfolio balances and USD values
- `get_tx_history` — paid normalized transaction history
- `get_wallet_report` — paid combined portfolio and transaction report

Paid tools cost up to 0.02 USDC per invocation on Base mainnet. Each invocation performs at most one payment attempt.

## Requirements

- Node.js 20 or newer
- A dedicated EVM agent wallet funded with Base USDC
- An MCP-compatible client

## MCP configuration

Add the following to your MCP client configuration. Replace the private key with a dedicated, low-balance agent wallet and keep the configuration out of source control.

```json
{
  "mcpServers": {
    "walletlens": {
      "command": "npx",
      "args": ["--yes", "@shawnwollenberg/walletlens-mcp@0.1.2"],
      "env": {
        "WALLETLENS_X402_PRIVATE_KEY": "0xYOUR_DEDICATED_AGENT_PRIVATE_KEY",
        "WALLETLENS_MAX_PAYMENT_USDC": "0.02",
        "WALLETLENS_EXPECTED_PAY_TO": "0xA7c82E9775A9594c673E3Fde8a42D3D17dE2B957"
      }
    }
  }
}
```

Free tools work without a private key. Paid tools return a `missing_private_key` result until `WALLETLENS_X402_PRIVATE_KEY` is configured.

## Payment safety policy

Before signing, the MCP server requires all of the following:

- `exact` payment scheme
- Base mainnet (`eip155:8453`)
- Base USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)
- Amount at or below `WALLETLENS_MAX_PAYMENT_USDC`, defaulting to 0.02 USDC
- WalletLens origin and the requested WalletLens resource path
- The configured recipient, defaulting to `0xA7c82E9775A9594c673E3Fde8a42D3D17dE2B957`

If a challenge violates the policy, the server refuses to sign it.

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `WALLETLENS_X402_PRIVATE_KEY` | Paid tools only | — | Dedicated local signing key |
| `WALLETLENS_MAX_PAYMENT_USDC` | No | `0.02` | Maximum payment per tool call |
| `WALLETLENS_EXPECTED_PAY_TO` | No | WalletLens recipient | Required payment recipient |
| `WALLETLENS_BASE_URL` | No | `https://walletlens.wallyweb.com` | WalletLens API origin |
| `WALLETLENS_REQUEST_TIMEOUT_MS` | No | `20000` | Request timeout in milliseconds |

## Run directly

```bash
npx --yes @shawnwollenberg/walletlens-mcp@0.1.2
```

The process communicates over MCP stdio and normally prints no human-readable output. Use `--help` or `--version` for CLI information.

## Links

- [WalletLens](https://walletlens.wallyweb.com)
- [OpenAPI](https://walletlens.wallyweb.com/openapi.json)
- [Agent documentation](https://walletlens.wallyweb.com/docs/walletlens-agent-skill.md)
- [Official MCP Registry](https://registry.modelcontextprotocol.io/?search=io.github.shawnwollenberg%2Fwalletlens)
- [Source repository](https://github.com/shawnwollenberg/web3_portfolio)
