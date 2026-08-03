import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { generateJwt } from "@coinbase/cdp-sdk/auth";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { RoutesConfig } from "@x402/core/server";
import type { Network } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import type { RequestHandler } from "express";
import { config } from "./config.js";
import {
  portfolioExample,
  portfolioInputSchema,
  portfolioOutputSchema,
  txHistoryExample,
  txHistoryInputSchema,
  txHistoryOutputSchema,
  walletReportExample,
  walletReportInputSchema,
  walletReportOutputSchema
} from "./schemas.js";

export const paymentRouteConfig = {
  "GET /portfolio": {
    accepts: {
      scheme: "exact",
      price: `$${config.x402PriceUsd}`,
      network: config.x402Network as Network,
      payTo: config.payTo ?? "0x0000000000000000000000000000000000000000",
      maxTimeoutSeconds: 120
    },
    resource: `${config.publicBaseUrl}/portfolio`,
    description:
      "WalletLens EVM portfolio API for token balances, native ETH, USD values, stablecoins, top holdings, and canonical Robinhood Stock Tokens with multiplier-adjusted prices and trading-halt status.",
    mimeType: "application/json",
    extensions: {
      ...declareDiscoveryExtension({
        input: {
          address: "0xfac1d7dC76bE90C5Cadd5B022af7838dd8190F16",
          chains: "robinhood"
        },
        inputSchema: portfolioInputSchema,
        output: {
          example: portfolioExample,
          schema: portfolioOutputSchema
        }
      })
    }
  },
  "GET /tx-history": {
    accepts: {
      scheme: "exact",
      price: `$${config.x402PriceUsd}`,
      network: config.x402Network as Network,
      payTo: config.payTo ?? "0x0000000000000000000000000000000000000000",
      maxTimeoutSeconds: 120
    },
    resource: `${config.publicBaseUrl}/tx-history`,
    description:
      "TxLens multi-chain EVM transaction history API for Base, Ethereum, and Robinhood Chain transfers with normalized summaries, counterparties, direction, categorization, labels, and data-quality flags.",
    mimeType: "application/json",
    extensions: {
      ...declareDiscoveryExtension({
        input: {
          address: "0x52E29e0d2Aa49bfBfC548C0A9F2196F4aa51f3ea",
          chains: "base",
          limit: 20,
          days: 30,
          category: "all"
        },
        inputSchema: txHistoryInputSchema,
        output: {
          example: txHistoryExample,
          schema: txHistoryOutputSchema
        }
      })
    }
  },
  "GET /wallet-report": {
    accepts: {
      scheme: "exact",
      price: `$${config.x402PriceUsd}`,
      network: config.x402Network as Network,
      payTo: config.payTo ?? "0x0000000000000000000000000000000000000000",
      maxTimeoutSeconds: 120
    },
    resource: `${config.publicBaseUrl}/wallet-report`,
    description:
      "WalletLens report API for agents: one x402 call returns EVM portfolio balances plus TxLens history, canonical Robinhood Stock Tokens, multiplier-adjusted USD values, halt status, top holdings, and counterparties.",
    mimeType: "application/json",
    extensions: {
      ...declareDiscoveryExtension({
        input: {
          address: "0x52E29e0d2Aa49bfBfC548C0A9F2196F4aa51f3ea",
          chains: "base",
          limit: 20,
          days: 30,
          category: "all"
        },
        inputSchema: walletReportInputSchema,
        output: {
          example: walletReportExample,
          schema: walletReportOutputSchema
        }
      })
    }
  }
} satisfies RoutesConfig;

export const paymentRoutes = paymentRouteConfig;

export function createPaymentMiddleware(): RequestHandler | null {
  if (config.x402DevBypass) return null;

  if (!config.payTo) {
    throw new Error("MY_WALLET_ADDRESS is required when X402_DEV_BYPASS is false");
  }

  const facilitator = new HTTPFacilitatorClient({
    url: config.x402FacilitatorUrl,
    createAuthHeaders: createFacilitatorAuthHeaders
  });

  const resourceServer = new x402ResourceServer(facilitator)
    .register(config.x402Network as Network, new ExactEvmScheme())
    .registerExtension(bazaarResourceServerExtension);

  return paymentMiddleware(paymentRoutes, resourceServer, {
    appName: "WalletLens API",
    testnet: config.x402Network !== "eip155:8453"
  });
}

async function createFacilitatorAuthHeaders() {
  if (!config.x402FacilitatorUrl.includes("api.cdp.coinbase.com")) {
    return {
      verify: {},
      settle: {},
      supported: {}
    };
  }

  if (!config.cdpApiKeyId || !config.cdpApiKeySecret) {
    throw new Error("CDP_API_KEY_ID and CDP_API_KEY_SECRET are required for the CDP x402 facilitator");
  }

  const headersFor = async (method: "GET" | "POST", endpoint: string) => ({
    Authorization: `Bearer ${await createCdpJwt(method, endpoint)}`
  });

  return {
    verify: await headersFor("POST", "verify"),
    settle: await headersFor("POST", "settle"),
    supported: await headersFor("GET", "supported")
  };
}

async function createCdpJwt(method: "GET" | "POST", endpoint: string): Promise<string> {
  const facilitatorUrl = new URL(config.x402FacilitatorUrl);
  const basePath = facilitatorUrl.pathname.replace(/\/+$/, "");

  return generateJwt({
    apiKeyId: config.cdpApiKeyId!,
    apiKeySecret: config.cdpApiKeySecret!,
    requestMethod: method,
    requestHost: facilitatorUrl.host,
    requestPath: `${basePath}/${endpoint}`,
    expiresIn: 120
  });
}
