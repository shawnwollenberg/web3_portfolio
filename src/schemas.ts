export const portfolioInputSchema = {
  properties: {
    address: {
      type: "string",
      pattern: "^0x[a-fA-F0-9]{40}$",
      description: "EVM wallet address."
    },
    chains: {
      type: "string",
      default: "base,ethereum",
      description: "Comma-separated supported chain slugs."
    }
  },
  required: ["address"],
  additionalProperties: false
} as const;

export const portfolioOutputSchema = {
  type: "object",
  properties: {
    address: { type: "string" },
    timestamp: { type: "string", format: "date-time" },
    chains: { type: "array", items: { type: "string" } },
    summary: {
      type: "object",
      properties: {
        totalValueUsd: { type: ["string", "null"] },
        pricedTokenCount: { type: "integer" },
        unpricedTokenCount: { type: "integer" },
        tokenCount: { type: "integer" },
        stablecoinValueUsd: { type: ["string", "null"] },
        chains: {
          type: "array",
          items: {
            type: "object",
            properties: {
              chain: { type: "string" },
              tokenCount: { type: "integer" },
              pricedTokenCount: { type: "integer" },
              unpricedTokenCount: { type: "integer" },
              totalValueUsd: { type: ["string", "null"] }
            },
            required: ["chain", "tokenCount", "pricedTokenCount", "unpricedTokenCount", "totalValueUsd"]
          }
        },
        topHoldings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              chain: { type: "string" },
              contract: { type: ["string", "null"] },
              symbol: { type: ["string", "null"] },
              name: { type: ["string", "null"] },
              valueUsd: { type: "string" }
            },
            required: ["chain", "contract", "symbol", "name", "valueUsd"]
          }
        },
        warnings: { type: "array", items: { type: "string" } }
      },
      required: [
        "totalValueUsd",
        "pricedTokenCount",
        "unpricedTokenCount",
        "tokenCount",
        "stablecoinValueUsd",
        "chains",
        "topHoldings",
        "warnings"
      ]
    },
    tokens: { type: "array", items: { type: "object" } },
    positions: { type: "array", items: {} },
    recentActivity: { type: "array", items: { type: "object" } },
    provider: { type: "string", const: "alchemy" }
  },
  required: ["address", "timestamp", "chains", "summary", "tokens", "positions", "recentActivity", "provider"]
} as const;

export const portfolioExample = {
  address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  timestamp: "2026-05-17T00:00:00.000Z",
  chains: ["base", "ethereum"],
  summary: {
    totalValueUsd: "1234.56",
    pricedTokenCount: 8,
    unpricedTokenCount: 2,
    tokenCount: 10,
    stablecoinValueUsd: "125.50",
    chains: [
      {
        chain: "base",
        tokenCount: 4,
        pricedTokenCount: 3,
        unpricedTokenCount: 1,
        totalValueUsd: "456.78"
      }
    ],
    topHoldings: [
      {
        chain: "ethereum",
        contract: null,
        symbol: "ETH",
        name: "Ether",
        valueUsd: "1000.00"
      }
    ],
    warnings: ["2 tokens are missing USD prices"]
  },
  tokens: [],
  positions: [],
  recentActivity: [],
  provider: "alchemy"
} as const;

