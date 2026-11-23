export const portfolioInputSchema = {
  description:
    "Query parameters for GET /portfolio. Price is $0.005 USDC per call, settled on Base (eip155:8453). Set chains=robinhood to receive canonical Robinhood Stock Token pricing. For portfolio plus transfer history, use GET /wallet-report at $0.02.",
  properties: {
    address: {
      type: "string",
      pattern: "^0x[a-fA-F0-9]{40}$",
      description: "EVM wallet address."
    },
    chains: {
      type: "string",
      default: "base,ethereum",
      description:
        "Comma-separated chain slugs. Include robinhood to label canonical Robinhood Stock Tokens with multiplier-adjusted USD prices and trading-halt status."
    }
  },
  required: ["address"],
  additionalProperties: false
} as const;

export const portfolioOutputSchema = {
  type: "object",
  description:
    "Normalized portfolio snapshot. summary.totalValueUsd, summary.stablecoinValueUsd, and summary.topHoldings are the agent-facing totals. tokens[].stockToken is present for canonical Robinhood Stock Tokens and includes bidUsd, askUsd, multiplier, and tradingHalt.",
  properties: {
    address: { type: "string" },
    timestamp: { type: "string", description: "ISO 8601 date-time." },
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
    tokens: {
      type: "array",
      items: {
        type: "object",
        properties: {
          chain: { type: "string" },
          chainId: { type: "string" },
          contract: { type: ["string", "null"] },
          symbol: { type: ["string", "null"] },
          name: { type: ["string", "null"] },
          decimals: { type: ["integer", "null"] },
          logo: { type: ["string", "null"] },
          rawBalance: { type: "string" },
          balance: { type: ["string", "null"] },
          priceUsd: { type: ["string", "null"] },
          valueUsd: { type: ["string", "null"] },
          assetType: { type: "string", enum: ["stock_token", "canonical_stablecoin"] },
          stockToken: {
            type: "object",
            properties: {
              canonical: { type: "boolean", const: true },
              uid: { type: "string" },
              underlyingSymbol: { type: "string" },
              multiplier: { type: "string" },
              bidUsd: { type: ["string", "null"] },
              askUsd: { type: ["string", "null"] },
              priceMethod: { type: ["string", "null"] },
              priceGeneratedAt: { type: ["string", "null"] },
              dailyTradingVolume: { type: ["string", "null"] },
              tradingHalt: { type: "boolean" },
              status: { type: "string" },
              tradingCapabilities: { type: ["object", "null"] }
            }
          }
        },
        required: [
          "chain",
          "chainId",
          "contract",
          "symbol",
          "name",
          "decimals",
          "logo",
          "rawBalance",
          "balance",
          "priceUsd",
          "valueUsd"
        ]
      }
    },
    positions: { type: "array", items: {} },
    recentActivity: { type: "array", items: { type: "object" } },
    provider: { type: "string", const: "alchemy" }
  },
  required: ["address", "timestamp", "chains", "summary", "tokens", "positions", "recentActivity", "provider"]
} as const;

export const portfolioExample = {
  address: "0xfac1d7dC76bE90C5Cadd5B022af7838dd8190F16",
  timestamp: "2026-08-03T00:00:00.000Z",
  chains: ["robinhood"],
  summary: {
    totalValueUsd: "961.15",
    pricedTokenCount: 1,
    unpricedTokenCount: 0,
    tokenCount: 1,
    stablecoinValueUsd: null,
    chains: [
      {
        chain: "robinhood",
        tokenCount: 1,
        pricedTokenCount: 1,
        unpricedTokenCount: 0,
        totalValueUsd: "961.15"
      }
    ],
    topHoldings: [
      {
        chain: "robinhood",
        contract: "0x1Cdad396DB64BDa184d5182A97Dd9B3C62100b7D",
        symbol: "P",
        name: "Everpure • Robinhood Token",
        valueUsd: "961.148033"
      }
    ],
    warnings: [
      "Robinhood Stock Token USD values use midpoint bid/ask prices multiplied by Robinhood's current corporate-action multiplier."
    ]
  },
  tokens: [
    {
      chain: "robinhood",
      chainId: "eip155:4663",
      contract: "0x1Cdad396DB64BDa184d5182A97Dd9B3C62100b7D",
      symbol: "P",
      name: "Everpure • Robinhood Token",
      decimals: 18,
      logo: "https://cdn.robinhood.com/ncw_assets/logos/0x1cdad396db64bda184d5182a97dd9b3c62100b7d.png",
      rawBalance: "12351719286313737501",
      balance: "12.351719286313737501",
      priceUsd: "77.815",
      valueUsd: "961.148033",
      assetType: "stock_token",
      stockToken: {
        canonical: true,
        uid: "0x0000000000000000000000000000000002c4d1ce31ec4310b2c507c921a52b70",
        underlyingSymbol: "P",
        multiplier: "1.000000000000000000",
        bidUsd: "76.00",
        askUsd: "79.63",
        priceMethod: "midpoint_multiplier_adjusted",
        priceGeneratedAt: "2026-08-03T00:00:00.000Z",
        dailyTradingVolume: "1971877",
        tradingHalt: false,
        status: "ASSET_STATUS_ACTIVE",
        tradingCapabilities: null
      }
    }
  ],
  positions: [],
  recentActivity: [],
  provider: "alchemy"
} as const;

export const txHistoryInputSchema = {
  description:
    "Query parameters for GET /tx-history. Price is $0.005 USDC per call, settled on Base (eip155:8453). For this history plus portfolio balances and Robinhood Stock Token pricing, use GET /wallet-report at $0.02.",
  properties: {
    address: {
      type: "string",
      pattern: "^0x[a-fA-F0-9]{40}$",
      description: "EVM wallet address."
    },
    chains: {
      type: "string",
      default: "base,ethereum",
      description: "Comma-separated supported chain slugs, including robinhood for Robinhood Chain mainnet."
    },
    limit: {
      type: "integer",
      default: 50,
      minimum: 1,
      maximum: 100,
      description: "Maximum enriched transfer rows to return."
    },
    days: {
      type: "integer",
      default: 30,
      minimum: 1,
      maximum: 365,
      description: "Lookback window applied to transaction timestamps."
    },
    category: {
      type: "string",
      enum: ["all", "external", "internal", "erc20", "erc721", "erc1155"],
      default: "all",
      description: "Alchemy transfer category filter."
    }
  },
  required: ["address"],
  additionalProperties: false
} as const;

export const txHistoryOutputSchema = {
  type: "object",
  description:
    "TxLens transfer history. summary.directions counts in, out, self, and unknown. Each transactions[] row has direction, counterparty, category, decoded.summary, labels, and riskFlags.",
  properties: {
    address: { type: "string" },
    timestamp: { type: "string", description: "ISO 8601 date-time." },
    chains: { type: "array", items: { type: "string" } },
    request: {
      type: "object",
      properties: {
        limit: { type: "integer" },
        days: { type: "integer" },
        category: { type: "string" }
      },
      required: ["limit", "days", "category"]
    },
    summary: {
      type: "object",
      properties: {
        transactionCount: { type: "integer" },
        chains: {
          type: "array",
          items: {
            type: "object",
            properties: {
              chain: { type: "string" },
              transactionCount: { type: "integer" }
            },
            required: ["chain", "transactionCount"]
          }
        },
        directions: {
          type: "object",
          properties: {
            in: { type: "integer" },
            out: { type: "integer" },
            self: { type: "integer" },
            unknown: { type: "integer" }
          },
          required: ["in", "out", "self", "unknown"]
        },
        actions: { type: "object", additionalProperties: { type: "integer" } },
        assets: {
          type: "array",
          items: {
            type: "object",
            properties: {
              asset: { type: "string" },
              count: { type: "integer" }
            },
            required: ["asset", "count"]
          }
        },
        warnings: { type: "array", items: { type: "string" } }
      },
      required: ["transactionCount", "chains", "directions", "actions", "assets", "warnings"]
    },
    transactions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          chain: { type: "string" },
          chainId: { type: "string" },
          hash: { type: "string" },
          uniqueId: { type: "string" },
          timestamp: { type: ["string", "null"] },
          blockNumber: { type: "string" },
          from: { type: ["string", "null"] },
          to: { type: ["string", "null"] },
          counterparty: { type: ["string", "null"] },
          direction: { type: "string", enum: ["in", "out", "self", "unknown"] },
          category: { type: "string" },
          type: { type: "string" },
          protocol: { type: ["string", "null"] },
          asset: { type: ["string", "null"] },
          value: { type: ["string", "null"] },
          tokenId: { type: ["string", "null"] },
          contract: { type: ["string", "null"] },
          valueUsd: { type: ["string", "null"] },
          decoded: { type: "object" },
          labels: { type: "array", items: { type: "string" } },
          riskFlags: { type: "array", items: { type: "string" } }
        },
        required: ["chain", "hash", "direction", "category", "type", "decoded", "labels"]
      }
    },
    pagination: {
      type: "object",
      properties: {
        pageKeys: {
          type: "array",
          items: {
            type: "object",
            properties: {
              chain: { type: "string" },
              direction: { type: "string", enum: ["in", "out"] },
              pageKey: { type: "string" }
            },
            required: ["chain", "direction", "pageKey"]
          }
        }
      },
      required: ["pageKeys"]
    },
    provider: { type: "string", const: "alchemy" },
    note: { type: "string" }
  },
  required: ["address", "timestamp", "chains", "request", "summary", "transactions", "pagination", "provider", "note"]
} as const;

export const txHistoryExample = {
  address: "0x52E29e0d2Aa49bfBfC548C0A9F2196F4aa51f3ea",
  timestamp: "2026-05-18T00:00:00.000Z",
  chains: ["base"],
  request: {
    limit: 20,
    days: 30,
    category: "all"
  },
  summary: {
    transactionCount: 2,
    chains: [{ chain: "base", transactionCount: 2 }],
    directions: { in: 1, out: 1, self: 0, unknown: 0 },
    actions: { token_transfer: 1, native_transfer: 1 },
    assets: [
      { asset: "USDC", count: 1 },
      { asset: "ETH", count: 1 }
    ],
    warnings: [
      "Stablecoin totals are symbol-based and may include unverified token contracts.",
      "USD values are currently null for transaction history."
    ]
  },
  transactions: [
    {
      chain: "base",
      chainId: "eip155:8453",
      hash: "0x...",
      uniqueId: "base:0x...",
      timestamp: "2026-05-18T00:00:00.000Z",
      blockNumber: "0x123",
      from: "0x...",
      to: "0x52E29e0d2Aa49bfBfC548C0A9F2196F4aa51f3ea",
      counterparty: "0x...",
      direction: "in",
      category: "erc20",
      type: "token_transfer",
      protocol: "Token",
      asset: "USDC",
      value: "7.36",
      tokenId: null,
      contract: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      valueUsd: null,
      decoded: {
        summary: "token_transfer of 7.36 USDC",
        event: "Transfer(address,address,uint256)"
      },
      labels: ["token_transfer", "erc20", "USDC"],
      riskFlags: []
    }
  ],
  pagination: {
    pageKeys: []
  },
  provider: "alchemy",
  note: "Enriched and normalized by WalletLens TxLens."
} as const;

export const walletReportInputSchema = {
  description:
    "Query parameters for GET /wallet-report. Price is $0.02 USDC per call, settled on Base (eip155:8453). This is the bundled /portfolio plus /tx-history response. Use chains=robinhood for canonical Robinhood Stock Tokens.",
  properties: {
    address: {
      type: "string",
      pattern: "^0x[a-fA-F0-9]{40}$",
      description: "EVM wallet address."
    },
    chains: {
      type: "string",
      default: "base,ethereum",
      description: "Comma-separated supported chain slugs used for both portfolio and transaction history, including robinhood."
    },
    limit: {
      type: "integer",
      default: 50,
      minimum: 1,
      maximum: 100,
      description: "Maximum enriched transaction rows to include in the bundled report."
    },
    days: {
      type: "integer",
      default: 30,
      minimum: 1,
      maximum: 365,
      description: "Lookback window applied to transaction timestamps."
    },
    category: {
      type: "string",
      enum: ["all", "external", "internal", "erc20", "erc721", "erc1155"],
      default: "all",
      description: "Transaction category filter for the TxLens section."
    }
  },
  required: ["address"],
  additionalProperties: false
} as const;

export const walletReportOutputSchema = {
  type: "object",
  description:
    "Bundled wallet report. summary covers portfolio value and transaction counts. portfolio is the GET /portfolio object. txHistory is the GET /tx-history object.",
  properties: {
    address: { type: "string" },
    timestamp: { type: "string", description: "ISO 8601 date-time." },
    chains: { type: "array", items: { type: "string" } },
    request: { type: "object" },
    summary: {
      type: "object",
      properties: {
        totalValueUsd: { type: ["string", "null"] },
        tokenCount: { type: "integer" },
        stablecoinValueUsd: { type: ["string", "null"] },
        topHoldings: { type: "array", items: { type: "object" } },
        transactionCount: { type: "integer" },
        transactionDirections: { type: "object" },
        transactionActions: { type: "object" },
        warnings: { type: "array", items: { type: "string" } }
      }
    },
    portfolio: {
      type: "object",
      description:
        "Full GET /portfolio snapshot: summary.totalValueUsd, summary.stablecoinValueUsd, summary.topHoldings, and tokens[].stockToken for canonical Robinhood Stock Tokens."
    },
    txHistory: {
      type: "object",
      description:
        "Full GET /tx-history snapshot: summary.directions plus transactions[].direction, counterparty, decoded.summary, labels, and riskFlags."
    },
    provider: { type: "string", const: "alchemy" },
    note: { type: "string" }
  },
  required: ["address", "timestamp", "chains", "request", "summary", "portfolio", "txHistory", "provider", "note"]
} as const;

export const walletReportExample = {
  address: "0x52E29e0d2Aa49bfBfC548C0A9F2196F4aa51f3ea",
  timestamp: "2026-05-19T00:00:00.000Z",
  chains: ["base"],
  request: {
    portfolioChains: "base",
    txHistoryChains: "base",
    limit: 20,
    days: 30,
    category: "all"
  },
  summary: {
    totalValueUsd: "7.37",
    tokenCount: 2,
    stablecoinValueUsd: "7.37",
    topHoldings: [
      {
        chain: "base",
        contract: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        symbol: "USDC",
        name: "USD Coin",
        valueUsd: "7.37"
      }
    ],
    transactionCount: 20,
    transactionDirections: { in: 20, out: 0, self: 0, unknown: 0 },
    transactionActions: { token_transfer: 20 },
    warnings: ["USD values are currently null for transaction history."]
  },
  portfolio: {
    address: "0x52E29e0d2Aa49bfBfC548C0A9F2196F4aa51f3ea",
    chains: ["base"],
    summary: {
      totalValueUsd: "7.37",
      tokenCount: 2,
      stablecoinValueUsd: "7.37"
    }
  },
  txHistory: {
    address: "0x52E29e0d2Aa49bfBfC548C0A9F2196F4aa51f3ea",
    chains: ["base"],
    summary: {
      transactionCount: 20,
      directions: { in: 20, out: 0, self: 0, unknown: 0 },
      actions: { token_transfer: 20 }
    },
    transactions: [
      {
        chain: "base",
        hash: "0x...",
        direction: "in",
        type: "token_transfer",
        asset: "USDC",
        value: "0.005"
      }
    ]
  },
  provider: "alchemy",
  note: "WalletLens report combines normalized portfolio balances with TxLens enriched transaction history for agent wallet analysis."
} as const;
