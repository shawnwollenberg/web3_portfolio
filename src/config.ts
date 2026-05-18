import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const optionalNonEmptyString = z.preprocess(
  value => (value === "" ? undefined : value),
  z.string().min(1).optional()
);

const boolFromString = z
  .string()
  .optional()
  .transform(value => value === "true" || value === "1");

const envSchema = z.object({
  ALCHEMY_API_KEY: optionalNonEmptyString,
  MY_WALLET_ADDRESS: optionalNonEmptyString,
  PORT: z.coerce.number().int().positive().default(3000),
  X402_DEV_BYPASS: boolFromString.default(true),
  X402_PRICE_USD: z.string().default("0.02"),
  X402_NETWORK: z.string().default("eip155:8453"),
  X402_FACILITATOR_URL: z.string().url().default("https://facilitator.x402.org"),
  CDP_API_KEY_ID: optionalNonEmptyString,
  CDP_API_KEY_SECRET: optionalNonEmptyString,
  PUBLIC_BASE_URL: z.string().url().default("https://walletlens.wallyweb.com"),
  PREVIEW_WALLET_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/).default("0x52E29e0d2Aa49bfBfC548C0A9F2196F4aa51f3ea"),
  PREVIEW_WALLET_CHAINS: z.string().default("base"),
  PREVIEW_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(600)
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment: ${parsed.error.message}`);
}

if (
  !parsed.data.X402_DEV_BYPASS &&
  (!parsed.data.MY_WALLET_ADDRESS || !/^0x[a-fA-F0-9]{40}$/.test(parsed.data.MY_WALLET_ADDRESS))
) {
  throw new Error("MY_WALLET_ADDRESS must be a valid EVM address when X402_DEV_BYPASS is false");
}

export const config = {
  alchemyApiKey: parsed.data.ALCHEMY_API_KEY,
  payTo: parsed.data.MY_WALLET_ADDRESS,
  port: parsed.data.PORT,
  x402DevBypass: parsed.data.X402_DEV_BYPASS,
  x402PriceUsd: parsed.data.X402_PRICE_USD,
  x402Network: parsed.data.X402_NETWORK,
  x402FacilitatorUrl: parsed.data.X402_FACILITATOR_URL,
  cdpApiKeyId: parsed.data.CDP_API_KEY_ID,
  cdpApiKeySecret: parsed.data.CDP_API_KEY_SECRET,
  publicBaseUrl: parsed.data.PUBLIC_BASE_URL.replace(/\/+$/, ""),
  previewWalletAddress: parsed.data.PREVIEW_WALLET_ADDRESS,
  previewWalletChains: parsed.data.PREVIEW_WALLET_CHAINS,
  previewCacheTtlSeconds: parsed.data.PREVIEW_CACHE_TTL_SECONDS
};
