import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

export const CDP_FACILITATOR_URL = "https://api.cdp.coinbase.com/platform/v2/x402";
export const COMPASS_URL = "https://compass.wallyweb.com";

export function isCompassLinkEnabled() {
  const value = process.env.COMPASS_LINK?.trim().toLowerCase();
  return value === "true" || value === "1";
}
const BASE_MAINNET = "eip155:8453";
const MIN_USDC_ATOMIC = 1_000n;

const optionalNonEmptyString = z.preprocess(
  value => (value === "" ? undefined : value),
  z.string().min(1).optional()
);

const boolFromString = z
  .string()
  .optional()
  .transform(value => value === "true" || value === "1");

const usdPrice = z
  .string()
  .regex(/^\d+(?:\.\d{1,6})?$/, "USD price must be a decimal with at most 6 fractional digits");

// node:test sets NODE_TEST_CONTEXT before importing test files. Pin payment
// settings so unit tests do not depend on a developer .env or call CDP.
if (process.env.NODE_TEST_CONTEXT) {
  process.env.MY_WALLET_ADDRESS = "0xA7c82E9775A9594c673E3Fde8a42D3D17dE2B957";
  process.env.CDP_API_KEY_ID = "test-key-id";
  process.env.CDP_API_KEY_SECRET = "test-key-secret";
  process.env.X402_DEV_BYPASS = "false";
  process.env.X402_NETWORK = BASE_MAINNET;
  process.env.X402_FACILITATOR_URL = CDP_FACILITATOR_URL;
  delete process.env.X402_PORTFOLIO_PRICE_USD;
  delete process.env.X402_TX_HISTORY_PRICE_USD;
  delete process.env.X402_WALLET_REPORT_PRICE_USD;
  delete process.env.X402_PRICE_USD;
}

const envSchema = z.object({
  ALCHEMY_API_KEY: optionalNonEmptyString,
  MY_WALLET_ADDRESS: optionalNonEmptyString,
  PORT: z.coerce.number().int().positive().default(3000),
  X402_DEV_BYPASS: boolFromString.default(false),
  X402_PORTFOLIO_PRICE_USD: usdPrice.default("0.005"),
  X402_TX_HISTORY_PRICE_USD: usdPrice.default("0.005"),
  X402_WALLET_REPORT_PRICE_USD: usdPrice.default("0.02"),
  X402_NETWORK: z.string().default(BASE_MAINNET),
  X402_FACILITATOR_URL: z.string().url().default(CDP_FACILITATOR_URL),
  CDP_API_KEY_ID: optionalNonEmptyString,
  CDP_API_KEY_SECRET: optionalNonEmptyString,
  PUBLIC_BASE_URL: z.string().url().default("https://walletlens.wallyweb.com"),
  PREVIEW_WALLET_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/).default("0x52E29e0d2Aa49bfBfC548C0A9F2196F4aa51f3ea"),
  PREVIEW_WALLET_CHAINS: z.string().default("base"),
  PREVIEW_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  ANALYTICS_IP_SALT: optionalNonEmptyString
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment: ${parsed.error.message}`);
}

if (process.env.X402_PRICE_USD) {
  console.warn(
    "X402_PRICE_USD is ignored. Set X402_PORTFOLIO_PRICE_USD, X402_TX_HISTORY_PRICE_USD, and X402_WALLET_REPORT_PRICE_USD."
  );
}

const portfolioPriceUsd = normalizeUsdPrice(parsed.data.X402_PORTFOLIO_PRICE_USD);
const txHistoryPriceUsd = normalizeUsdPrice(parsed.data.X402_TX_HISTORY_PRICE_USD);
const walletReportPriceUsd = normalizeUsdPrice(parsed.data.X402_WALLET_REPORT_PRICE_USD);

for (const [name, price] of [
  ["X402_PORTFOLIO_PRICE_USD", portfolioPriceUsd],
  ["X402_TX_HISTORY_PRICE_USD", txHistoryPriceUsd],
  ["X402_WALLET_REPORT_PRICE_USD", walletReportPriceUsd]
] as const) {
  if (usdToAtomic(price) < MIN_USDC_ATOMIC) {
    throw new Error(`${name} must be at least 0.001 USDC. The CDP facilitator rejects smaller x402 prices.`);
  }
}

if (
  !parsed.data.X402_DEV_BYPASS &&
  (!parsed.data.MY_WALLET_ADDRESS || !/^0x[a-fA-F0-9]{40}$/.test(parsed.data.MY_WALLET_ADDRESS))
) {
  throw new Error("MY_WALLET_ADDRESS must be a valid EVM address when X402_DEV_BYPASS is false");
}

const usesCdpFacilitator = isCdpFacilitatorUrl(parsed.data.X402_FACILITATOR_URL);

if (!parsed.data.X402_DEV_BYPASS && usesCdpFacilitator && (!parsed.data.CDP_API_KEY_ID || !parsed.data.CDP_API_KEY_SECRET)) {
  throw new Error(
    "CDP_API_KEY_ID and CDP_API_KEY_SECRET are required when X402_DEV_BYPASS is false. " +
      "The Coinbase CDP facilitator settles Base USDC payments and is what indexes WalletLens in the x402 Bazaar."
  );
}

export const config = {
  alchemyApiKey: parsed.data.ALCHEMY_API_KEY,
  payTo: parsed.data.MY_WALLET_ADDRESS,
  port: parsed.data.PORT,
  x402DevBypass: parsed.data.X402_DEV_BYPASS,
  x402PortfolioPriceUsd: portfolioPriceUsd,
  x402TxHistoryPriceUsd: txHistoryPriceUsd,
  x402WalletReportPriceUsd: walletReportPriceUsd,
  x402Network: parsed.data.X402_NETWORK,
  x402FacilitatorUrl: parsed.data.X402_FACILITATOR_URL.replace(/\/+$/, ""),
  usesCdpFacilitator,
  cdpAuthConfigured: Boolean(parsed.data.CDP_API_KEY_ID && parsed.data.CDP_API_KEY_SECRET),
  cdpApiKeyId: parsed.data.CDP_API_KEY_ID,
  cdpApiKeySecret: parsed.data.CDP_API_KEY_SECRET,
  publicBaseUrl: parsed.data.PUBLIC_BASE_URL.replace(/\/+$/, ""),
  previewWalletAddress: parsed.data.PREVIEW_WALLET_ADDRESS,
  previewWalletChains: parsed.data.PREVIEW_WALLET_CHAINS,
  previewCacheTtlSeconds: parsed.data.PREVIEW_CACHE_TTL_SECONDS,
  providerTimeoutMs: parsed.data.PROVIDER_TIMEOUT_MS,
  analyticsIpSalt: parsed.data.ANALYTICS_IP_SALT,
  bazaarEligible:
    !parsed.data.X402_DEV_BYPASS &&
    usesCdpFacilitator &&
    parsed.data.X402_NETWORK === BASE_MAINNET &&
    Boolean(parsed.data.CDP_API_KEY_ID && parsed.data.CDP_API_KEY_SECRET)
};

function isCdpFacilitatorUrl(value: string) {
  try {
    return new URL(value).hostname.endsWith("cdp.coinbase.com");
  } catch {
    return false;
  }
}

function normalizeUsdPrice(value: string) {
  const match = value.trim().match(/^(\d+)(?:\.(\d{1,6}))?$/);
  if (!match) return value.trim();
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  return fraction ? `${Number(match[1])}.${fraction}` : String(Number(match[1]));
}

function usdToAtomic(value: string) {
  const match = value.match(/^(\d+)(?:\.(\d{1,6}))?$/);
  if (!match) return 0n;
  return BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0"));
}
