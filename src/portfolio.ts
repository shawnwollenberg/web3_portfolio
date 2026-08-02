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

  const [tokenResponse, activityResult] = await Promise.all([
    providerCall(
      alchemy.portfolio.getTokensByWallet([portfolioAddress], true, true, true),
      "Alchemy portfolio token request"
    ),
    providerCall(
      alchemy.portfolio.getTransactionsByWallet([portfolioAddress], undefined, undefined, 10),
      "Alchemy recent activity request"
    )
      .then(response => ({ response, warning: null }))
      .catch(error => ({
        response: { transactions: [] },
        warning: error instanceof Error ? `${error.message}; recentActivity is incomplete.` : "Recent activity is incomplete."
      }))
  ]);

  const tokens = tokenResponse.data.tokens
    .map(token => normalizeToken(token as ProviderToken))
    .filter(token => token.rawBalance !== "0");
  const recentActivity = (activityResult.response.transactions as ProviderTransaction[]).map(normalizeTransaction);
  const summary = buildPortfolioSummary(tokens);
  if (activityResult.warning) summary.warnings.push(activityResult.warning);

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

async function providerCall<T>(request: Promise<T>, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out after ${config.providerTimeoutMs}ms`)), config.providerTimeoutMs);
  });

  try {
    return await Promise.race([request, timeoutPromise]);
  } catch (cause) {
    const error = new Error(`${label} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    error.name = "ProviderError";
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function normalizeToken(token: ProviderToken): PortfolioToken {
  const network = typeof token.network === "string" ? token.network : undefined;
  const chain = network ? networkToChain(network as never) : undefined;
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
