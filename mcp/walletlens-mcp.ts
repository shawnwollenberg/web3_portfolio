#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { z } from "zod";
import { privateKeyToAccount } from "viem/accounts";

type HexPrivateKey = `0x${string}`;

const baseUrl = (process.env.WALLETLENS_BASE_URL || "https://walletlens.wallyweb.com").replace(/\/+$/, "");

const server = new McpServer({
  name: "walletlens",
  version: "1.0.0"
});

server.registerTool(
  "get_service_metadata",
  {
    description: "Return WalletLens service, pricing, discovery, and documentation URLs.",
    inputSchema: {}
  },
  async () => {
    const metadata = {
      name: "WalletLens API",
      baseUrl,
      paidEndpoint: `${baseUrl}/portfolio`,
      price: "$0.02",
      paymentProtocol: "x402",
      paymentNetwork: "eip155:8453",
      asset: "USDC on Base",
      discovery: {
        x402: `${baseUrl}/.well-known/x402.json`,
        llms: `${baseUrl}/llms.txt`,
        llmsFull: `${baseUrl}/llms-full.txt`,
        openapi: `${baseUrl}/openapi.json`,
        skill: `${baseUrl}/docs/walletlens-agent-skill.md`
      }
    };

    return jsonToolResult(metadata);
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
      supportedChains: ["base", "ethereum", "eth", "optimism", "arbitrum", "polygon"],
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
    const response = await fetch(`${baseUrl}/openapi.json`);
    const body = await response.json();
    return jsonToolResult(body);
  }
);

server.registerTool(
  "get_portfolio",
  {
    description:
      "Fetch a paid WalletLens portfolio snapshot via x402. Requires WALLETLENS_X402_PRIVATE_KEY or X402_TEST_PRIVATE_KEY in the MCP server environment.",
    inputSchema: {
      address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).describe("EVM wallet address."),
      chains: z.string().default("base,ethereum").describe("Comma-separated supported chain slugs.")
    }
  },
  async ({ address, chains }) => {
    const privateKey = normalizePrivateKey(process.env.WALLETLENS_X402_PRIVATE_KEY || process.env.X402_TEST_PRIVATE_KEY);
    const url = new URL(`${baseUrl}/portfolio`);
    url.searchParams.set("address", address);
    url.searchParams.set("chains", chains);

    if (!privateKey) {
      return jsonToolResult({
        error: "missing_private_key",
        message:
          "Set WALLETLENS_X402_PRIVATE_KEY or X402_TEST_PRIVATE_KEY in the MCP server environment to enable paid x402 calls.",
        unpaidUrl: url.toString()
      });
    }

    const account = privateKeyToAccount(privateKey);
    const coreClient = new x402Client();
    registerExactEvmScheme(coreClient, { signer: account });
    const client = new x402HTTPClient(coreClient);

    const initialResponse = await fetch(url);
    if (initialResponse.status !== 402) {
      return jsonToolResult({
        error: "unexpected_initial_response",
        status: initialResponse.status,
        body: await readResponseBody(initialResponse)
      });
    }

    const paymentRequired = client.getPaymentRequiredResponse(
      name => initialResponse.headers.get(name),
      await tryReadJson(initialResponse)
    );
    const paymentPayload = await client.createPaymentPayload(paymentRequired);
    const paidResponse = await fetch(url, {
      headers: client.encodePaymentSignatureHeader(paymentPayload)
    });

    const body = await readResponseBody(paidResponse);
    if (!paidResponse.ok) {
      return jsonToolResult({
        error: "paid_request_failed",
        status: paidResponse.status,
        body
      });
    }

    return jsonToolResult({
      payer: account.address,
      settlement: tryGetSettlement(client, paidResponse),
      portfolio: JSON.parse(body)
    });
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);

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
    throw new Error("x402 private key must be a 32-byte hex private key, with or without 0x prefix.");
  }

  return withPrefix as HexPrivateKey;
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

async function readResponseBody(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return "";

  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function tryGetSettlement(client: x402HTTPClient, response: Response) {
  try {
    return client.getPaymentSettleResponse(name => response.headers.get(name));
  } catch {
    return null;
  }
}

