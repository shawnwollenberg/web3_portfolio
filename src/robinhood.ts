const ROBINHOOD_API_BASE_URL = "https://api.robinhood.com/rhj";
const ROBINHOOD_CHAIN_ID = 4663;
const ASSET_CACHE_TTL_MS = 15 * 60 * 1000;
const QUOTE_CACHE_TTL_MS = 15 * 1000;

export type RobinhoodTradingCapabilities = {
  fractionalTradability: string | null;
  allDayTradability: string | null;
  extendedHoursFractionalTradability: boolean | null;
};

export type RobinhoodStockToken = {
  id: string;
  tokenSymbol: string;
  tokenName: string;
  contractAddress: string;
  currentMultiplier: string;
  logoUrl: string | null;
  status: string;
  tradingCapabilities: RobinhoodTradingCapabilities | null;
};

export type RobinhoodStockQuote = {
  tokenSymbol: string;
  bid: string;
  ask: string;
  currency: string;
  dailyTradingVolume: string;
  isTradingHalt: boolean;
  generatedAt: string;
};

export type RobinhoodStockTokenMarketData = {
  asset: RobinhoodStockToken;
  quote: RobinhoodStockQuote | null;
};

type RobinhoodAssetResponse = {
  assets?: Array<{
    id?: unknown;
    tokenSymbol?: unknown;
    tokenName?: unknown;
    deployments?: Array<{ contractAddress?: unknown; chainId?: unknown }>;
    currentMultiplier?: unknown;
    logoUrl?: unknown;
    status?: unknown;
    tradingCapabilities?: Partial<RobinhoodTradingCapabilities> | null;
  }>;
};

type RobinhoodQuoteResponse = {
  quotes?: Array<{
    tokenSymbol?: unknown;
    bid?: unknown;
    ask?: unknown;
    currency?: unknown;
    dailyTradingVolume?: unknown;
    isTradingHalt?: unknown;
    generatedAt?: unknown;
  }>;
};

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

let assetCache: CacheEntry<Map<string, RobinhoodStockToken>> | null = null;
let quoteCache: CacheEntry<Map<string, RobinhoodStockQuote>> | null = null;

export const ROBINHOOD_CANONICAL_USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";

export async function getRobinhoodStockTokenMarketData(
  contractAddresses: Array<string | null>,
  timeoutMs: number
): Promise<Map<string, RobinhoodStockTokenMarketData>> {
  const requested = new Set(contractAddresses.filter((address): address is string => Boolean(address)).map(normalizeAddress));
  if (requested.size === 0) return new Map();

  const assets = await getAssets(timeoutMs);
  const matchedAssets = [...requested]
    .map(address => assets.get(address))
    .filter((asset): asset is RobinhoodStockToken => Boolean(asset));
  if (matchedAssets.length === 0) return new Map();

  const quotes = await getQuotes(timeoutMs);
  return new Map(
    matchedAssets.map(asset => [
      normalizeAddress(asset.contractAddress),
      {
        asset,
        quote: quotes.get(asset.tokenSymbol.toUpperCase()) ?? null
      }
    ])
  );
}

async function getAssets(timeoutMs: number): Promise<Map<string, RobinhoodStockToken>> {
  if (assetCache && assetCache.expiresAt > Date.now()) return assetCache.value;

  const response = await fetchJson<RobinhoodAssetResponse>(`${ROBINHOOD_API_BASE_URL}/assets`, timeoutMs);
  const assets = new Map<string, RobinhoodStockToken>();

  for (const rawAsset of response.assets ?? []) {
    const deployment = rawAsset.deployments?.find(item => item.chainId === ROBINHOOD_CHAIN_ID);
    const contractAddress = asString(deployment?.contractAddress);
    const id = asString(rawAsset.id);
    const tokenSymbol = asString(rawAsset.tokenSymbol);
    const tokenName = asString(rawAsset.tokenName);
    const currentMultiplier = asString(rawAsset.currentMultiplier);
    if (!contractAddress || !id || !tokenSymbol || !tokenName || !currentMultiplier) continue;

    assets.set(normalizeAddress(contractAddress), {
      id,
      tokenSymbol,
      tokenName,
      contractAddress,
      currentMultiplier,
      logoUrl: asString(rawAsset.logoUrl),
      status: asString(rawAsset.status) ?? "ASSET_STATUS_UNSPECIFIED",
      tradingCapabilities: normalizeTradingCapabilities(rawAsset.tradingCapabilities)
    });
  }

  assetCache = { value: assets, expiresAt: Date.now() + ASSET_CACHE_TTL_MS };
  return assets;
}

async function getQuotes(timeoutMs: number): Promise<Map<string, RobinhoodStockQuote>> {
  if (quoteCache && quoteCache.expiresAt > Date.now()) return quoteCache.value;

  const response = await fetchJson<RobinhoodQuoteResponse>(`${ROBINHOOD_API_BASE_URL}/prices`, timeoutMs);
  const quotes = new Map<string, RobinhoodStockQuote>();

  for (const rawQuote of response.quotes ?? []) {
    const tokenSymbol = asString(rawQuote.tokenSymbol);
    const bid = asString(rawQuote.bid);
    const ask = asString(rawQuote.ask);
    const currency = asString(rawQuote.currency) ?? "USD";
    if (!tokenSymbol || !bid || !ask || currency.toUpperCase() !== "USD") continue;

    quotes.set(tokenSymbol.toUpperCase(), {
      tokenSymbol,
      bid,
      ask,
      currency,
      dailyTradingVolume: asString(rawQuote.dailyTradingVolume) ?? "0",
      isTradingHalt: rawQuote.isTradingHalt === true,
      generatedAt: asString(rawQuote.generatedAt) ?? new Date().toISOString()
    });
  }

  quoteCache = { value: quotes, expiresAt: Date.now() + QUOTE_CACHE_TTL_MS };
  return quotes;
}

async function fetchJson<T>(url: string, timeoutMs: number): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (cause) {
    throw new Error(`Robinhood Stock Token request failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  }

  if (!response.ok) {
    throw new Error(`Robinhood Stock Token request failed with HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}

function normalizeAddress(value: string) {
  return value.toLowerCase();
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeTradingCapabilities(
  value: Partial<RobinhoodTradingCapabilities> | null | undefined
): RobinhoodTradingCapabilities | null {
  if (!value) return null;
  return {
    fractionalTradability: asString(value.fractionalTradability),
    allDayTradability: asString(value.allDayTradability),
    extendedHoursFractionalTradability:
      typeof value.extendedHoursFractionalTradability === "boolean" ? value.extendedHoursFractionalTradability : null
  };
}
