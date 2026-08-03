#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { z } from "zod";
import { privateKeyToAccount } from "viem/accounts";
import {
  assertSafePaymentRequired,
  filterSafePaymentRequirements,
  parseUsdcAmountToAtomic,
  type WalletLensPaymentPolicy
} from "./payment-policy.js";

type HexPrivateKey = `0x${string}`;
type PaidEndpoint = "/portfolio" | "/tx-history" | "/wallet-report";

const PACKAGE_VERSION = "0.1.1";
const DEFAULT_BASE_URL = "https://walletlens.wallyweb.com";
const DEFAULT_PAY_TO = "0xA7c82E9775A9594c673E3Fde8a42D3D17dE2B957";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  process.stdout.write(`WalletLens MCP ${PACKAGE_VERSION}\n\nRun this command from an MCP client over stdio.\n\nEnvironment:\n  WALLETLENS_X402_PRIVATE_KEY   Dedicated agent-wallet signing key for paid tools\n  WALLETLENS_MAX_PAYMENT_USDC  Maximum per-call payment (default: 0.02)\n  WALLETLENS_EXPECTED_PAY_TO   Required recipient (defaults to WalletLens)\n  WALLETLENS_BASE_URL          API origin (default: ${DEFAULT_BASE_URL})\n  WALLETLENS_REQUEST_TIMEOUT_MS Request timeout (default: 20000)\n`);
  process.exit(0);
}

if (process.argv.includes("--version") || process.argv.includes("-v")) {
  process.stdout.write(`${PACKAGE_VERSION}\n`);
  process.exit(0);
}

const baseUrl = (process.env.WALLETLENS_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
const requestTimeoutMs = parsePositiveInteger(process.env.WALLETLENS_REQUEST_TIMEOUT_MS, 20_000);
const maxAmountAtomic = parseUsdcAmountToAtomic(process.env.WALLETLENS_MAX_PAYMENT_USDC || "0.02");
const expectedPayTo = normalizeAddress(process.env.WALLETLENS_EXPECTED_PAY_TO || DEFAULT_PAY_TO);

const server = new McpServer({
  name: "walletlens",
  version: PACKAGE_VERSION
});

server.registerTool(
  "get_service_metadata",
  {
    description: "Return live WalletLens service, pricing, discovery, and documentation metadata.",
    inputSchema: {}
  },
  async () => {
    const response = await fetchWithTimeout(`${baseUrl}/discover`);
    return jsonToolResult(await readJsonResponse(response, "WalletLens discovery"));
  }
);

server.registerTool(
  "get_supported_chains",
  {
    description: "Return WalletLens supported EVM chain slugs.",
    inputSchema: {}
  },
  async () =>
    jsonToolResult({
      defaultChains: ["base", "ethereum"],
      supportedChains: ["base", "ethereum", "eth", "optimism", "arbitrum", "polygon", "robinhood"],
      solanaSupported: false
    })
);

server.registerTool(
  "get_openapi_schema",
  {
    description: "Fetch the public WalletLens OpenAPI schema.",
    inputSchema: {}
  },
  async () => {
    const response = await fetchWithTimeout(`${baseUrl}/openapi.json`);
    return jsonToolResult(await readJsonResponse(response, "WalletLens OpenAPI schema"));
  }
);

server.registerTool(
  "get_portfolio",
  {
    description:
      "Fetch a paid WalletLens portfolio snapshot, including canonical Robinhood Stock Tokens when chains=robinhood. Requires WALLETLENS_X402_PRIVATE_KEY.",
    inputSchema: {
      address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).describe("EVM wallet address."),
      chains: z.string().default("base,ethereum").describe("Comma-separated supported chain slugs.")
    }
  },
  async ({ address, chains }) => {
    const url = buildUrl("/portfolio", { address, chains });
    return paidToolResult("portfolio", "/portfolio", url);
  }
);

const txHistoryInputSchema = {
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).describe("EVM wallet address."),
  chains: z.string().default("base,ethereum").describe("Comma-separated supported chain slugs."),
  limit: z.number().int().positive().max(100).default(50).describe("Maximum rows to return."),
  days: z.number().int().positive().max(365).default(30).describe("Transaction lookback window."),
  category: z
    .enum(["all", "external", "internal", "erc20", "erc721", "erc1155"])
    .default("all")
    .describe("Transfer category filter.")
};

server.registerTool(
  "get_tx_history",
  {
    description:
      "Fetch paid TxLens enriched transaction history via x402. Requires WALLETLENS_X402_PRIVATE_KEY in the MCP server environment.",
    inputSchema: txHistoryInputSchema
  },
  async ({ address, chains, limit, days, category }) => {
    const url = buildUrl("/tx-history", { address, chains, limit, days, category });
    return paidToolResult("txHistory", "/tx-history", url);
  }
);

server.registerTool(
  "get_wallet_report",
  {
    description:
      "Fetch a paid WalletLens report with portfolio balances, transaction history, and Robinhood Stock Token intelligence. Requires WALLETLENS_X402_PRIVATE_KEY.",
    inputSchema: txHistoryInputSchema
  },
  async ({ address, chains, limit, days, category }) => {
    const url = buildUrl("/wallet-report", { address, chains, limit, days, category });
    return paidToolResult("walletReport", "/wallet-report", url);
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);

async function paidToolResult(resultKey: string, endpoint: PaidEndpoint, url: URL) {
  try {
    const privateKey = normalizePrivateKey(process.env.WALLETLENS_X402_PRIVATE_KEY);
    if (!privateKey) {
      return jsonToolResult({
        error: "missing_private_key",
        message: "Set WALLETLENS_X402_PRIVATE_KEY in the MCP server environment to enable paid x402 calls.",
        unpaidUrl: url.toString()
      });
    }

    const result = await callPaidEndpoint(endpoint, url, privateKey);
    return jsonToolResult({
      payer: result.payer,
      settlement: result.settlement,
      [resultKey]: result.body
    });
  } catch (error) {
    return jsonToolResult({
      error: "walletlens_request_failed",
      message: error instanceof Error ? error.message : String(error),
      endpoint,
      url: url.toString()
    });
  }
}

async function callPaidEndpoint(endpoint: PaidEndpoint, url: URL, privateKey: HexPrivateKey) {
  const account = privateKeyToAccount(privateKey);
  const policy: WalletLensPaymentPolicy = {
    baseUrl,
    expectedPath: endpoint,
    maxAmountAtomic,
    expectedPayTo
  };
  const coreClient = new x402Client();
  coreClient.registerPolicy((_version, requirements) => filterSafePaymentRequirements(requirements, policy));
  registerExactEvmScheme(coreClient, { signer: account });
  const client = new x402HTTPClient(coreClient);

  const initialResponse = await fetchWithTimeout(url);
  if (initialResponse.status !== 402) {
    throw new Error(
      `Expected HTTP 402 before payment, received ${initialResponse.status}: ${await readResponseBody(initialResponse)}`
    );
  }

  const paymentRequired = client.getPaymentRequiredResponse(
    name => initialResponse.headers.get(name),
    await tryReadJson(initialResponse)
  );
  assertSafePaymentRequired(paymentRequired, policy);

  const paymentPayload = await client.createPaymentPayload(paymentRequired);
  const paidResponse = await fetchWithTimeout(url, {
    headers: client.encodePaymentSignatureHeader(paymentPayload)
  });
  const responseBody = await readJsonResponse(paidResponse, `Paid ${endpoint} response`);

  return {
    payer: account.address,
    settlement: tryGetSettlement(client, paidResponse),
    body: responseBody
  };
}

function buildUrl(endpoint: PaidEndpoint, params: Record<string, string | number>) {
  const url = new URL(`${baseUrl}${endpoint}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return url;
}

async function fetchWithTimeout(input: string | URL, init: RequestInit = {}) {
  return fetch(input, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(requestTimeoutMs)
  });
}

function jsonToolResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function normalizePrivateKey(value: string | undefined): HexPrivateKey | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const withPrefix = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;

  if (!/^0x[a-fA-F0-9]{64}$/.test(withPrefix)) {
    throw new Error("WALLETLENS_X402_PRIVATE_KEY must be a 32-byte hex private key, with or without 0x prefix.");
  }

  return withPrefix as HexPrivateKey;
}

function normalizeAddress(value: string): string {
  const trimmed = value.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
    throw new Error("WALLETLENS_EXPECTED_PAY_TO must be a valid EVM address.");
  }
  return trimmed;
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error("WALLETLENS_REQUEST_TIMEOUT_MS must be positive.");
  return parsed;
}

async function tryReadJson(response: Response): Promise<unknown | undefined> {
  const text = await response.text();
  if (!text) return undefined;

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function readJsonResponse(response: Response, label: string): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}: ${formatResponseText(text)}`);
  if (!text) throw new Error(`${label} returned an empty body.`);

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} did not return JSON: ${formatResponseText(text)}`);
  }
}

async function readResponseBody(response: Response): Promise<string> {
  return formatResponseText(await response.text());
}

function formatResponseText(text: string) {
  if (!text) return "(empty body)";
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return text.slice(0, 500);
  }
}

function tryGetSettlement(client: x402HTTPClient, response: Response) {
  try {
    return client.getPaymentSettleResponse(name => response.headers.get(name));
  } catch {
    return null;
  }
}
