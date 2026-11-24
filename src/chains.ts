export type AlchemyNetworkId =
  | "eth-mainnet"
  | "base-mainnet"
  | "opt-mainnet"
  | "arb-mainnet"
  | "polygon-mainnet"
  | "robinhood-mainnet";

export type SupportedChain = {
  slug: string;
  label: string;
  alchemyNetwork: AlchemyNetworkId;
  caip2: string;
  supportsInternalTransfers?: boolean;
};

export const supportedChainSlugs = ["base", "ethereum", "optimism", "arbitrum", "polygon", "robinhood"] as const;

export const supportedChains: Record<string, SupportedChain> = {
  ethereum: {
    slug: "ethereum",
    label: "Ethereum",
    alchemyNetwork: "eth-mainnet",
    caip2: "eip155:1"
  },
  eth: {
    slug: "ethereum",
    label: "Ethereum",
    alchemyNetwork: "eth-mainnet",
    caip2: "eip155:1"
  },
  base: {
    slug: "base",
    label: "Base",
    alchemyNetwork: "base-mainnet",
    caip2: "eip155:8453"
  },
  optimism: {
    slug: "optimism",
    label: "Optimism",
    alchemyNetwork: "opt-mainnet",
    caip2: "eip155:10"
  },
  arbitrum: {
    slug: "arbitrum",
    label: "Arbitrum One",
    alchemyNetwork: "arb-mainnet",
    caip2: "eip155:42161"
  },
  polygon: {
    slug: "polygon",
    label: "Polygon",
    alchemyNetwork: "polygon-mainnet",
    caip2: "eip155:137"
  },
  robinhood: {
    slug: "robinhood",
    label: "Robinhood Chain",
    alchemyNetwork: "robinhood-mainnet",
    caip2: "eip155:4663",
    supportsInternalTransfers: false
  },
  "robinhood-chain": {
    slug: "robinhood",
    label: "Robinhood Chain",
    alchemyNetwork: "robinhood-mainnet",
    caip2: "eip155:4663",
    supportsInternalTransfers: false
  },
  rh: {
    slug: "robinhood",
    label: "Robinhood Chain",
    alchemyNetwork: "robinhood-mainnet",
    caip2: "eip155:4663",
    supportsInternalTransfers: false
  }
};

export function parseChains(input?: string): SupportedChain[] {
  const requested = (input || "base,ethereum")
    .split(",")
    .map(chain => chain.trim().toLowerCase())
    .filter(Boolean);

  const unique = new Map<string, SupportedChain>();

  for (const slug of requested) {
    const chain = supportedChains[slug];
    if (!chain) {
      throw new Error(`Unsupported chain: ${slug}`);
    }
    unique.set(chain.slug, chain);
  }

  return [...unique.values()].slice(0, supportedChainSlugs.length);
}

export function networkToChain(network: string): SupportedChain | undefined {
  return Object.values(supportedChains).find(chain => chain.alchemyNetwork === network);
}

export const chainAliases = {
  eth: "ethereum",
  "robinhood-chain": "robinhood",
  rh: "robinhood"
} as const;

const canonicalChains = [...supportedChainSlugs];

export const routeChainSupport = {
  portfolio: {
    path: "/portfolio" as const,
    chains: canonicalChains,
    note: "Token balances on base, ethereum, optimism, arbitrum, polygon, and robinhood. Canonical Robinhood Stock Token prices, bid/ask, multiplier, and trading-halt status when chains includes robinhood. recentActivity excludes Robinhood Chain."
  },
  txHistory: {
    path: "/tx-history" as const,
    chains: canonicalChains,
    note: "Transfer history on base, ethereum, optimism, arbitrum, polygon, and robinhood. Internal transfer traces are unavailable on robinhood. Transaction USD values are null. This route does not price Robinhood Stock Tokens."
  },
  walletReport: {
    path: "/wallet-report" as const,
    chains: canonicalChains,
    note: "Portfolio and transfer history on base, ethereum, optimism, arbitrum, polygon, and robinhood. Stock Token pricing when chains includes robinhood. recentActivity excludes Robinhood Chain. Internal traces are unavailable on robinhood."
  }
};

export const helperChainSupport = {
  paths: ["/ask", "/analyze", "/quote"] as const,
  chains: canonicalChains,
  note: "The free /ask, /analyze, and /quote helpers accept the same six slugs and only build paid URLs."
};

export function buildChainSupport() {
  return {
    slugs: canonicalChains,
    aliases: chainAliases,
    helpers: helperChainSupport,
    routes: routeChainSupport
  };
}
