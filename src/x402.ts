import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { createWalletLensCdpFacilitatorClient } from "./cdp-facilitator.js";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { RoutesConfig } from "@x402/core/server";
import type { Network, SupportedResponse } from "@x402/core/types";
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

const portfolioPrice = config.x402PortfolioPriceUsd;
const txHistoryPrice = config.x402TxHistoryPriceUsd;
const walletReportPrice = config.x402WalletReportPriceUsd;

// CDP's x402V2PaymentPayload.resource.description is Description, maxLength 500
// (JavaScript characters, not bytes). Clients echo this string into verify and
// settle, and 501 characters fails the whole payload. Stay under 450 so a
// longer configured price cannot cross the limit. Field-level input and output
// detail stays in the Bazaar schemas, OpenAPI, and llms.txt.
export const CDP_RESOURCE_DESCRIPTION_MAX = 450;

const portfolioDescription =
  `$${portfolioPrice} USDC per call on Base (eip155:8453). Canonical Robinhood Stock Tokens plus EVM balances on base, ethereum, optimism, arbitrum, polygon, and robinhood. Price, bid/ask, and halt status on robinhood. recentActivity skips robinhood. Holdings plus transfers: GET /wallet-report ($${walletReportPrice}).`;

const txHistoryDescription =
  `$${txHistoryPrice} USDC per call on Base (eip155:8453). Transfer history on base, ethereum, optimism, arbitrum, polygon, and robinhood: direction, counterparty, category, and decoded summaries. Internal traces are unavailable on robinhood. Query: address, chains, limit, days, category. With portfolio: GET /wallet-report ($${walletReportPrice}).`;

const walletReportDescription =
  `$${walletReportPrice} USDC per call on Base (eip155:8453). Bundles the $${portfolioPrice} portfolio snapshot and $${txHistoryPrice} transfer history on the same six chains, including canonical Robinhood Stock Token prices and halt status. recentActivity skips robinhood. Query: address, chains, limit, days, category.`;

export const paymentRouteConfig = {
  "GET /portfolio": paidRoute("/portfolio", portfolioPrice, portfolioDescription, {
    input: {
      address: "0xfac1d7dC76bE90C5Cadd5B022af7838dd8190F16",
      chains: "robinhood"
    },
    inputSchema: portfolioInputSchema,
    output: {
      example: portfolioExample,
      schema: portfolioOutputSchema
    }
  }),
  "GET /tx-history": paidRoute("/tx-history", txHistoryPrice, txHistoryDescription, {
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
  }),
  "GET /wallet-report": paidRoute("/wallet-report", walletReportPrice, walletReportDescription, {
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
} satisfies RoutesConfig;

export const paymentRoutes = paymentRouteConfig;

export function createPaymentMiddleware(): RequestHandler | null {
  if (config.x402DevBypass) return null;

  if (!config.payTo) {
    throw new Error("MY_WALLET_ADDRESS is required when X402_DEV_BYPASS is false");
  }

  const facilitator = createFacilitatorClient();
  const resourceServer = new x402ResourceServer(facilitator)
    .register(config.x402Network as Network, new ExactEvmScheme())
    .registerExtension(bazaarResourceServerExtension);

  return paymentMiddleware(paymentRoutes, resourceServer, {
    appName: "WalletLens API",
    testnet: config.x402Network !== "eip155:8453"
  });
}

function paidRoute(
  path: string,
  priceUsd: string,
  description: string,
  discovery: Parameters<typeof declareDiscoveryExtension>[0]
) {
  if (description.length > CDP_RESOURCE_DESCRIPTION_MAX) {
    throw new Error(
      `${path} resource.description is ${description.length} characters. CDP rejects verify and settle when it exceeds 500; keep it at or below ${CDP_RESOURCE_DESCRIPTION_MAX}.`
    );
  }

  return {
    accepts: {
      scheme: "exact" as const,
      price: `$${priceUsd}`,
      network: config.x402Network as Network,
      payTo: config.payTo ?? "0x0000000000000000000000000000000000000000",
      maxTimeoutSeconds: 120
    },
    resource: `${config.publicBaseUrl}${path}`,
    description,
    mimeType: "application/json" as const,
    extensions: {
      ...declareDiscoveryExtension(discovery)
    }
  };
}

function createFacilitatorClient() {
  // Avoid calling CDP /supported from unit tests. Production never sets this.
  if (process.env.NODE_TEST_CONTEXT) {
    return new StaticTestFacilitator();
  }

  if (config.usesCdpFacilitator) {
    return createWalletLensCdpFacilitatorClient({
      apiKeyId: config.cdpApiKeyId,
      apiKeySecret: config.cdpApiKeySecret,
      baseUrl: config.x402FacilitatorUrl
    });
  }

  console.warn(
    `WalletLens facilitator ${config.x402FacilitatorUrl} is not the Coinbase CDP facilitator. ` +
      "Settlements on this URL are not indexed in the x402 Bazaar."
  );
  return new HTTPFacilitatorClient({ url: config.x402FacilitatorUrl });
}

class StaticTestFacilitator extends HTTPFacilitatorClient {
  constructor() {
    super({ url: config.x402FacilitatorUrl });
  }

  override getSupported(): Promise<SupportedResponse> {
    return Promise.resolve({
      kinds: [
        {
          x402Version: 2,
          scheme: "exact",
          network: config.x402Network as Network
        }
      ],
      extensions: [],
      signers: {}
    });
  }
}
