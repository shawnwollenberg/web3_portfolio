import { z } from "zod";
import {
  getAlchemyPortfolioTokens,
  getAlchemyPortfolioTransactions,
  type TokenPrice
} from "./alchemy.js";
import { config } from "./config.js";
import { networkToChain, parseChains } from "./chains.js";
import {
  getRobinhoodStockTokenMarketData,
  ROBINHOOD_CANONICAL_USDG,
  type RobinhoodStockTokenMarketData,
  type RobinhoodTradingCapabilities
} from "./robinhood.js";

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
  assetType?: "stock_token" | "canonical_stablecoin";
  stockToken?: {
    canonical: true;
    uid: string;
    underlyingSymbol: string;
    multiplier: string;
    bidUsd: string | null;
    askUsd: string | null;
    priceMethod: "midpoint_multiplier_adjusted" | null;
    priceGeneratedAt: string | null;
    dailyTradingVolume: string | null;
    tradingHalt: boolean;
    status: string;
    tradingCapabilities: RobinhoodTradingCapabilities | null;
  };
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
  const recentActivityChains = chains.filter(chain => chain.slug !== "robinhood");
  const recentActivityAddress = {
    address: parsedAddress.data,
    networks: recentActivityChains.map(chain => chain.alchemyNetwork)
  };

  const [tokenResponse, activityResult] = await Promise.all([
    getAlchemyPortfolioTokens([portfolioAddress]),
    recentActivityChains.length === 0
      ? Promise.resolve({
          response: { transactions: [] },
          warning:
            "Portfolio recentActivity excludes Robinhood Chain; WalletLens TxLens transaction history remains available."
        })
      : getAlchemyPortfolioTransactions([recentActivityAddress], 10)
          .then(response => ({
            response,
            warning: chains.length === recentActivityChains.length
              ? null
              : "Portfolio recentActivity excludes Robinhood Chain; WalletLens TxLens transaction history remains available."
          }))
          .catch(error => ({
            response: { transactions: [] },
            warning: error instanceof Error ? `${error.message}; recentActivity is incomplete.` : "Recent activity is incomplete."
          }))
  ]);

  let tokens = tokenResponse.data.tokens
    .map(token => normalizeToken(token as ProviderToken))
    .filter(token => token.rawBalance !== "0");
  const enrichmentWarnings: string[] = [];
  if (chains.some(chain => chain.slug === "robinhood")) {
    tokens = tokens.map(enrichRobinhoodCanonicalAsset);
    if (tokens.some(token => token.assetType === "canonical_stablecoin")) {
      enrichmentWarnings.push("Canonical Robinhood Chain USDG is valued at its $1 USD reference price.");
    }

    try {
      const marketData = await getRobinhoodStockTokenMarketData(
        tokens.filter(token => token.chain === "robinhood").map(token => token.contract),
        config.providerTimeoutMs
      );
      tokens = tokens.map(token => enrichRobinhoodStockToken(token, marketData));
      if (tokens.some(token => token.assetType === "stock_token")) {
        enrichmentWarnings.push(
          "Robinhood Stock Token USD values use midpoint bid/ask prices multiplied by Robinhood's current corporate-action multiplier."
        );
      }
      const haltedSymbols = tokens
        .filter(token => token.stockToken?.tradingHalt)
        .map(token => token.stockToken!.underlyingSymbol);
      if (haltedSymbols.length > 0) {
        enrichmentWarnings.push(`Robinhood reports an active trading halt for: ${[...new Set(haltedSymbols)].join(", ")}.`);
      }
    } catch (error) {
      enrichmentWarnings.push(
        `${error instanceof Error ? error.message : "Robinhood Stock Token enrichment failed"}; canonical stock-token metadata and prices may be incomplete.`
      );
    }
  }
  const recentActivity = (activityResult.response.transactions as ProviderTransaction[]).map(normalizeTransaction);
  const summary = buildPortfolioSummary(tokens);
  if (activityResult.warning) summary.warnings.push(activityResult.warning);
  summary.warnings.push(...enrichmentWarnings);

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

function enrichRobinhoodCanonicalAsset(token: PortfolioToken): PortfolioToken {
  if (
    token.chain !== "robinhood" ||
    token.contract?.toLowerCase() !== ROBINHOOD_CANONICAL_USDG
  ) {
    return token;
  }

  return {
    ...token,
    symbol: "USDG",
    name: "Global Dollar",
    priceUsd: "1",
    valueUsd: token.balance ? multiplyDecimalStrings(token.balance, "1") : null,
    assetType: "canonical_stablecoin"
  };
}

function normalizeToken(token: ProviderToken): PortfolioToken {
  const network = typeof token.network === "string" ? token.network : undefined;
  const chain = network ? networkToChain(network) : undefined;
  const metadata = token.tokenMetadata;
  const decimals = metadata?.decimals ?? null;
  const rawBalance = normalizeRawBalance(token.tokenBalance);
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

function enrichRobinhoodStockToken(
  token: PortfolioToken,
  marketData: Map<string, RobinhoodStockTokenMarketData>
): PortfolioToken {
  if (token.chain !== "robinhood" || !token.contract) return token;
  const data = marketData.get(token.contract.toLowerCase());
  if (!data) return token;

  const midpoint = data.quote ? averageDecimalStrings(data.quote.bid, data.quote.ask) : null;
  const adjustedPrice = midpoint ? multiplyDecimalStrings(midpoint, data.asset.currentMultiplier) : null;
  const priceUsd = adjustedPrice ?? token.priceUsd;

  return {
    ...token,
    symbol: data.asset.tokenSymbol,
    name: data.asset.tokenName,
    logo: data.asset.logoUrl ?? token.logo,
    priceUsd,
    valueUsd: token.balance && priceUsd ? multiplyDecimalStrings(token.balance, priceUsd) : null,
    assetType: "stock_token",
    stockToken: {
      canonical: true,
      uid: data.asset.id,
      underlyingSymbol: data.asset.tokenSymbol,
      multiplier: data.asset.currentMultiplier,
      bidUsd: data.quote?.bid ?? null,
      askUsd: data.quote?.ask ?? null,
      priceMethod: adjustedPrice ? "midpoint_multiplier_adjusted" : null,
      priceGeneratedAt: data.quote?.generatedAt ?? null,
      dailyTradingVolume: data.quote?.dailyTradingVolume ?? null,
      tradingHalt: data.quote?.isTradingHalt ?? false,
      status: data.asset.status,
      tradingCapabilities: data.asset.tradingCapabilities
    }
  };
}

function normalizeTransaction(tx: ProviderTransaction): RecentActivity {
  const network = typeof tx.network === "string" ? tx.network : undefined;
  const chain = network ? networkToChain(network) : undefined;

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

function normalizeRawBalance(value: unknown): string {
  if (typeof value !== "string") return String(value ?? "0");
  if (/^0x[0-9a-fA-F]+$/.test(value)) {
    return BigInt(value).toString(10);
  }
  return value;
}

export function formatTokenAmount(raw: string, decimals: number): string {
  if (!/^\d+$/.test(raw)) return raw;
  if (!Number.isInteger(decimals) || decimals <= 0) return raw;
  if (decimals > 255) return raw;

  const padded = raw.padStart(decimals + 1, "0");
  const integer = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");

  return fraction ? `${integer}.${fraction}` : integer;
}

export function multiplyDecimalStrings(left: string, right: string, maxFractionDigits = 6): string | null {
  const leftDecimal = parseDecimal(left);
  const rightDecimal = parseDecimal(right);
  if (!leftDecimal || !rightDecimal || maxFractionDigits < 0 || !Number.isInteger(maxFractionDigits)) return null;

  let unscaled = leftDecimal.unscaled * rightDecimal.unscaled;
  let scale = leftDecimal.scale + rightDecimal.scale;

  if (scale > maxFractionDigits) {
    const divisor = 10n ** BigInt(scale - maxFractionDigits);
    const remainder = unscaled % divisor;
    unscaled /= divisor;
    if (remainder * 2n >= divisor) unscaled += 1n;
    scale = maxFractionDigits;
  }

  if (scale === 0) return unscaled.toString();
  const padded = unscaled.toString().padStart(scale + 1, "0");
  const integer = padded.slice(0, -scale);
  const fraction = padded.slice(-scale).replace(/0+$/, "");
  return fraction ? `${integer}.${fraction}` : integer;
}

export function averageDecimalStrings(left: string, right: string, maxFractionDigits = 6): string | null {
  const leftDecimal = parseDecimal(left);
  const rightDecimal = parseDecimal(right);
  if (!leftDecimal || !rightDecimal) return null;

  const scale = Math.max(leftDecimal.scale, rightDecimal.scale);
  const leftUnscaled = leftDecimal.unscaled * 10n ** BigInt(scale - leftDecimal.scale);
  const rightUnscaled = rightDecimal.unscaled * 10n ** BigInt(scale - rightDecimal.scale);
  const sum = leftUnscaled + rightUnscaled;
  if (sum % 2n === 0n) {
    return formatScaledDecimal(sum / 2n, scale, maxFractionDigits);
  }
  return formatScaledDecimal(sum * 5n, scale + 1, maxFractionDigits);
}

function formatScaledDecimal(unscaled: bigint, scale: number, maxFractionDigits: number): string | null {
  if (!Number.isInteger(maxFractionDigits) || maxFractionDigits < 0) return null;
  let normalized = unscaled;
  let normalizedScale = scale;
  if (normalizedScale > maxFractionDigits) {
    const divisor = 10n ** BigInt(normalizedScale - maxFractionDigits);
    const remainder = normalized % divisor;
    normalized /= divisor;
    if (remainder * 2n >= divisor) normalized += 1n;
    normalizedScale = maxFractionDigits;
  }
  if (normalizedScale === 0) return normalized.toString();
  const padded = normalized.toString().padStart(normalizedScale + 1, "0");
  const integer = padded.slice(0, -normalizedScale);
  const fraction = padded.slice(-normalizedScale).replace(/0+$/, "");
  return fraction ? `${integer}.${fraction}` : integer;
}

function parseDecimal(value: string): { unscaled: bigint; scale: number } | null {
  const match = value.trim().match(/^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/);
  if (!match) return null;

  const fraction = match[2] ?? "";
  const exponent = Number(match[3] ?? "0");
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) return null;

  let digits = `${match[1]}${fraction}`.replace(/^0+(?=\d)/, "");
  let scale = fraction.length - exponent;
  if (scale < 0) {
    digits += "0".repeat(-scale);
    scale = 0;
  }
  if (scale > 1000) return null;

  return { unscaled: BigInt(digits || "0"), scale };
}

function buildPortfolioSummary(tokens: PortfolioToken[]): PortfolioSummary {
  const pricedTokens = tokens.filter(token => token.valueUsd !== null);
  const unpricedTokenCount = tokens.length - pricedTokens.length;
  const chainMap = new Map<string, { tokenCount: number; pricedTokenCount: number; totalValueMicros: bigint }>();
  let totalValueMicros = 0n;
  let stablecoinValueMicros = 0n;

  for (const token of tokens) {
    const chainSummary = chainMap.get(token.chain) ?? {
      tokenCount: 0,
      pricedTokenCount: 0,
      totalValueMicros: 0n
    };

    chainSummary.tokenCount += 1;

    const valueMicros = decimalToScaledInteger(token.valueUsd, 6);
    if (valueMicros !== null) {
      totalValueMicros += valueMicros;
      chainSummary.pricedTokenCount += 1;
      chainSummary.totalValueMicros += valueMicros;

      if (isStablecoin(token.symbol)) {
        stablecoinValueMicros += valueMicros;
      }
    }

    chainMap.set(token.chain, chainSummary);
  }

  const warnings: string[] = [];
  if (unpricedTokenCount > 0) {
    warnings.push(`${unpricedTokenCount} token${unpricedTokenCount === 1 ? " is" : "s are"} missing USD prices`);
  }
  if (stablecoinValueMicros > 0n) {
    warnings.push("Stablecoin totals are symbol-based and may include unverified token contracts.");
  }

  return {
    totalValueUsd: pricedTokens.length > 0 ? formatUsd(totalValueMicros) : null,
    pricedTokenCount: pricedTokens.length,
    unpricedTokenCount,
    tokenCount: tokens.length,
    stablecoinValueUsd: stablecoinValueMicros > 0n ? formatUsd(stablecoinValueMicros) : null,
    chains: [...chainMap.entries()]
      .sort((left, right) => compareBigInts(right[1].totalValueMicros, left[1].totalValueMicros))
      .map(([chain, summary]) => ({
        chain,
        tokenCount: summary.tokenCount,
        pricedTokenCount: summary.pricedTokenCount,
        unpricedTokenCount: summary.tokenCount - summary.pricedTokenCount,
        totalValueUsd: summary.pricedTokenCount > 0 ? formatUsd(summary.totalValueMicros) : null
      })),
    topHoldings: pricedTokens
      .map(token => ({
        chain: token.chain,
        contract: token.contract,
        symbol: token.symbol,
        name: token.name,
        valueUsd: token.valueUsd!
      }))
      .sort((left, right) =>
        compareBigInts(
          decimalToScaledInteger(right.valueUsd, 6) ?? 0n,
          decimalToScaledInteger(left.valueUsd, 6) ?? 0n
        )
      )
      .slice(0, 10),
    warnings
  };
}

function decimalToScaledInteger(value: string | null, targetScale: number): bigint | null {
  if (value === null) return null;
  const parsed = parseDecimal(value);
  if (!parsed) return null;
  if (parsed.scale === targetScale) return parsed.unscaled;
  if (parsed.scale < targetScale) return parsed.unscaled * 10n ** BigInt(targetScale - parsed.scale);

  const divisor = 10n ** BigInt(parsed.scale - targetScale);
  const quotient = parsed.unscaled / divisor;
  return (parsed.unscaled % divisor) * 2n >= divisor ? quotient + 1n : quotient;
}

function formatUsd(valueMicros: bigint): string {
  const cents = (valueMicros + 5_000n) / 10_000n;
  const padded = cents.toString().padStart(3, "0");
  const integer = padded.slice(0, -2);
  const fraction = padded.slice(-2).replace(/0+$/, "");
  return fraction ? `${integer}.${fraction}` : integer;
}

function compareBigInts(left: bigint, right: bigint) {
  return left === right ? 0 : left > right ? 1 : -1;
}

function isStablecoin(symbol: string | null): boolean {
  if (!symbol) return false;
  return ["USDC", "USDT", "DAI", "USDS", "USDE", "PYUSD", "LUSD", "FRAX"].includes(symbol.toUpperCase());
}
