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
  summary: PortfolioSummary;
  tokens: PortfolioToken[];
  positions: unknown[];
  recentActivity: RecentActivity[];
  provider: "alchemy";
};

export type PortfolioSummary = {
  totalValueUsd: string | null;
  pricedTokenCount: number;
  unpricedTokenCount: number;
  tokenCount: number;
  stablecoinValueUsd: string | null;
  chains: ChainSummary[];
  topHoldings: TopHolding[];
  warnings: string[];
};

export type ChainSummary = {
  chain: string;
  tokenCount: number;
  pricedTokenCount: number;
  unpricedTokenCount: number;
  totalValueUsd: string | null;
};

export type TopHolding = {
  chain: string;
  contract: string | null;
  symbol: string | null;
  name: string | null;
  valueUsd: string;
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
  const summary = buildPortfolioSummary(tokens);

  return {
    address: parsedAddress.data,
    timestamp: new Date().toISOString(),
    chains: chains.map(chain => chain.slug),
    summary,
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

function buildPortfolioSummary(tokens: PortfolioToken[]): PortfolioSummary {
  const pricedTokens = tokens.filter(token => token.valueUsd !== null);
  const unpricedTokenCount = tokens.length - pricedTokens.length;
  const chainMap = new Map<string, { tokenCount: number; pricedTokenCount: number; totalValue: number }>();
  let totalValue = 0;
  let stablecoinValue = 0;

  for (const token of tokens) {
    const chainSummary = chainMap.get(token.chain) ?? {
      tokenCount: 0,
      pricedTokenCount: 0,
      totalValue: 0
    };

    chainSummary.tokenCount += 1;

    const value = parseUsdValue(token.valueUsd);
    if (value !== null) {
      totalValue += value;
      chainSummary.pricedTokenCount += 1;
      chainSummary.totalValue += value;

      if (isStablecoin(token.symbol)) {
        stablecoinValue += value;
      }
    }

    chainMap.set(token.chain, chainSummary);
  }

  const warnings: string[] = [];
  if (unpricedTokenCount > 0) {
    warnings.push(`${unpricedTokenCount} token${unpricedTokenCount === 1 ? " is" : "s are"} missing USD prices`);
  }

  return {
    totalValueUsd: pricedTokens.length > 0 ? formatUsd(totalValue) : null,
    pricedTokenCount: pricedTokens.length,
    unpricedTokenCount,
    tokenCount: tokens.length,
    stablecoinValueUsd: stablecoinValue > 0 ? formatUsd(stablecoinValue) : null,
    chains: [...chainMap.entries()]
      .map(([chain, summary]) => ({
        chain,
        tokenCount: summary.tokenCount,
        pricedTokenCount: summary.pricedTokenCount,
        unpricedTokenCount: summary.tokenCount - summary.pricedTokenCount,
        totalValueUsd: summary.pricedTokenCount > 0 ? formatUsd(summary.totalValue) : null
      }))
      .sort((left, right) => Number(right.totalValueUsd ?? 0) - Number(left.totalValueUsd ?? 0)),
    topHoldings: pricedTokens
      .map(token => ({
        chain: token.chain,
        contract: token.contract,
        symbol: token.symbol,
        name: token.name,
        valueUsd: token.valueUsd!
      }))
      .sort((left, right) => Number(right.valueUsd) - Number(left.valueUsd))
      .slice(0, 10),
    warnings
  };
}

function parseUsdValue(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatUsd(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function isStablecoin(symbol: string | null): boolean {
  if (!symbol) return false;
  return ["USDC", "USDT", "DAI", "USDS", "USDE", "PYUSD", "LUSD", "FRAX"].includes(symbol.toUpperCase());
}
