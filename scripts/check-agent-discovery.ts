type PaymentChallenge = {
  extensions?: Record<string, unknown>;
  accepts?: Array<{ payTo?: string }>;
};

type MerchantDiscovery = {
  resources?: Array<{ resource?: string }>;
};

type SearchDiscovery = {
  resources?: Array<{ resource?: string }>;
};

const baseUrl = (process.env.WALLETLENS_BASE_URL || "https://walletlens.wallyweb.com").replace(/\/+$/, "");
const demoAddress = process.env.WALLETLENS_DISCOVERY_TEST_ADDRESS || "0x52E29e0d2Aa49bfBfC548C0A9F2196F4aa51f3ea";
const timeoutMs = 20_000;
const paidUrl = new URL(`${baseUrl}/wallet-report`);
paidUrl.searchParams.set("address", demoAddress);
paidUrl.searchParams.set("chains", "base");
paidUrl.searchParams.set("limit", "1");

const response = await fetch(paidUrl, { signal: AbortSignal.timeout(timeoutMs) });
if (response.status !== 402) {
  throw new Error(`Expected ${paidUrl.origin}/wallet-report to return HTTP 402, received ${response.status}.`);
}

const paymentRequiredHeader = response.headers.get("payment-required") || response.headers.get("x-payment-required");
if (!paymentRequiredHeader) throw new Error("The WalletLens 402 response did not include a payment-required header.");

const challenge = JSON.parse(Buffer.from(paymentRequiredHeader, "base64url").toString("utf8")) as PaymentChallenge;
const hasBazaarExtension = Boolean(challenge.extensions?.bazaar);
const payTo = challenge.accepts?.[0]?.payTo;
if (!payTo) throw new Error("The WalletLens payment challenge did not include a payTo address.");

const merchantUrl = new URL("https://api.cdp.coinbase.com/platform/v2/x402/discovery/merchant");
merchantUrl.searchParams.set("payTo", payTo);
merchantUrl.searchParams.set("limit", "100");
const searchUrl = new URL("https://api.cdp.coinbase.com/platform/v2/x402/discovery/search");
searchUrl.searchParams.set("query", "WalletLens EVM wallet report portfolio transaction history");
searchUrl.searchParams.set("limit", "20");

const [merchantResponse, searchResponse] = await Promise.all([
  fetch(merchantUrl, { signal: AbortSignal.timeout(timeoutMs) }),
  fetch(searchUrl, { signal: AbortSignal.timeout(timeoutMs) })
]);
const merchant = (merchantResponse.ok ? await merchantResponse.json() : {}) as MerchantDiscovery;
const search = (searchResponse.ok ? await searchResponse.json() : {}) as SearchDiscovery;
const isWalletLensResource = (resource: { resource?: string }) =>
  typeof resource.resource === "string" && resource.resource.startsWith(baseUrl);
const merchantMatches = (merchant.resources ?? []).filter(isWalletLensResource).length;
const searchMatches = (search.resources ?? []).filter(isWalletLensResource).length;

console.log(
  JSON.stringify(
    {
      ok: hasBazaarExtension && merchantMatches > 0 && searchMatches > 0,
      service: baseUrl,
      paymentChallenge: {
        status: response.status,
        hasBazaarExtension
      },
      cdpBazaar: {
        merchantMatches,
        searchMatches
      },
      nextStep:
        merchantMatches > 0 && searchMatches > 0
          ? "WalletLens is discoverable in the CDP Bazaar."
          : "No WalletLens match is indexed yet. After a successful CDP-facilitated settlement, indexing may be asynchronous; retry later and ensure each paid resource has settled at least once."
    },
    null,
    2
  )
);

if (!hasBazaarExtension || merchantMatches === 0 || searchMatches === 0) process.exitCode = 1;
