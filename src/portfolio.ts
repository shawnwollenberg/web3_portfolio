import { Alchemy, type TokenPrice } from "alchemy-sdk";
import { z } from "zod";
import { config } from "./config.js";
import { networkToChain, parseChains } from "./chains.js";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

export type PortfolioToken = {
  chain: string;
  chainId: string;
  contract: string | null;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  logo: string | null;
  rawBalance: string;
  balance: string | null;
  priceUsd: string | null;
  valueUsd: string | null;
};

export type RecentActivity = {
  chain: string | null;
  hash: string | null;
  from: string | null;
  to: string | null;
  blockNumber: number | string | null;
  timestamp: string | null;
};

export type PortfolioSnapshot = {
  address: string;
  timestamp: string;
  chains: string[];
  tokens: PortfolioToken[];
  positions: unknown[];
  recentActivity: RecentActivity[];
  provider: "alchemy";
};

type ProviderToken = {
  network?: unknown;
  address?: unknown;
  tokenAddress?: unknown;
  contractAddress?: unknown;
  tokenBalance?: unknown;
  tokenMetadata?: {
    name?: string | null;
    symbol?: string | null;
    decimals?: number | null;
    logo?: string | null;
  };
  tokenPrices?: TokenPrice[];
};

type ProviderTransaction = {
  network?: unknown;
  hash?: unknown;
  transactionHash?: unknown;
  from?: unknown;
  to?: unknown;
  blockNumber?: unknown;
  timestamp?: unknown;
};

const alchemy = new Alchemy({
  apiKey: config.alchemyApiKey,
  authToken: config.alchemyApiKey
});

export async function getPortfolioSnapshot(address: string, chainInput?: string): Promise<PortfolioSnapshot> {
  const parsedAddress = addressSchema.safeParse(address);
  if (!parsedAddress.success) {
    const error = new Error("Invalid EVM address");
    error.name = "ValidationError";
    throw error;
  }

  if (!config.alchemyApiKey) {
    const error = new Error("ALCHEMY_API_KEY is required");
    error.name = "ConfigurationError";
    throw error;
  }

  const chains = parseChains(chainInput);
  const portfolioAddress = {
    address: parsedAddress.data,
    networks: chains.map(chain => chain.alchemyNetwork)
  };

  const [tokenResponse, txResponse] = await Promise.all([
    alchemy.portfolio.getTokensByWallet([portfolioAddress], true, true, true),
    alchemy.portfolio.getTransactionsByWallet([portfolioAddress], undefined, undefined, 10).catch(() => ({
      transactions: []
    }))
  ]);

  const tokens = tokenResponse.data.tokens.map(token => normalizeToken(token as ProviderToken));
  const recentActivity = (txResponse.transactions as ProviderTransaction[]).map(normalizeTransaction);

  return {
    address: parsedAddress.data,
    timestamp: new Date().toISOString(),
    chains: chains.map(chain => chain.slug),
    tokens,
    positions: [],
    recentActivity,
    provider: "alchemy"
  };
}

function normalizeToken(token: ProviderToken): PortfolioToken {
  const network = typeof token.network === "string" ? token.network : undefined;
  const chain = network ? networkToChain(network as never) : undefined;
  const metadata = token.tokenMetadata;
  const decimals = metadata?.decimals ?? null;
  const rawBalance = typeof token.tokenBalance === "string" ? token.tokenBalance : String(token.tokenBalance ?? "0");
  const priceUsd = token.tokenPrices?.find(price => price.currency.toLowerCase() === "usd")?.value ?? null;
  const balance = decimals === null ? null : formatTokenAmount(rawBalance, decimals);

  return {
    chain: chain?.slug ?? network ?? "unknown",
    chainId: chain?.caip2 ?? network ?? "unknown",
    contract: stringOrNull(token.tokenAddress) ?? stringOrNull(token.contractAddress),
    symbol: metadata?.symbol ?? null,
    name: metadata?.name ?? null,
    decimals,
    logo: metadata?.logo ?? null,
    rawBalance,
    balance,
    priceUsd,
    valueUsd: balance && priceUsd ? multiplyDecimalStrings(balance, priceUsd) : null
  };
}

function normalizeTransaction(tx: ProviderTransaction): RecentActivity {
  const network = typeof tx.network === "string" ? tx.network : undefined;
  const chain = network ? networkToChain(network as never) : undefined;

  return {
    chain: chain?.slug ?? network ?? null,
    hash: stringOrNull(tx.hash) ?? stringOrNull(tx.transactionHash),
    from: stringOrNull(tx.from),
    to: stringOrNull(tx.to),
    blockNumber: numberOrStringOrNull(tx.blockNumber),
    timestamp: stringOrNull(tx.timestamp)
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOrStringOrNull(value: unknown): number | string | null {
  if (typeof value === "number" || typeof value === "string") return value;
  return null;
}

export function formatTokenAmount(raw: string, decimals: number): string {
  if (!/^\d+$/.test(raw)) return raw;
  if (decimals <= 0) return raw;

  const padded = raw.padStart(decimals + 1, "0");
  const integer = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");

  return fraction ? `${integer}.${fraction}` : integer;
}

function multiplyDecimalStrings(left: string, right: string): string | null {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return null;
  return (leftNumber * rightNumber).toFixed(6).replace(/\.?0+$/, "");
}

