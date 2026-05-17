import { Network } from "alchemy-sdk";

export type SupportedChain = {
  slug: string;
  label: string;
  alchemyNetwork: Network;
  caip2: string;
};

export const supportedChains: Record<string, SupportedChain> = {
  ethereum: {
    slug: "ethereum",
    label: "Ethereum",
    alchemyNetwork: Network.ETH_MAINNET,
    caip2: "eip155:1"
  },
  eth: {
    slug: "ethereum",
    label: "Ethereum",
    alchemyNetwork: Network.ETH_MAINNET,
    caip2: "eip155:1"
  },
  base: {
    slug: "base",
    label: "Base",
    alchemyNetwork: Network.BASE_MAINNET,
    caip2: "eip155:8453"
  },
  optimism: {
    slug: "optimism",
    label: "Optimism",
    alchemyNetwork: Network.OPT_MAINNET,
    caip2: "eip155:10"
  },
  arbitrum: {
    slug: "arbitrum",
    label: "Arbitrum One",
    alchemyNetwork: Network.ARB_MAINNET,
    caip2: "eip155:42161"
  },
  polygon: {
    slug: "polygon",
    label: "Polygon",
    alchemyNetwork: Network.MATIC_MAINNET,
    caip2: "eip155:137"
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

  return [...unique.values()].slice(0, 5);
}

export function networkToChain(network: Network): SupportedChain | undefined {
  return Object.values(supportedChains).find(chain => chain.alchemyNetwork === network);
}

