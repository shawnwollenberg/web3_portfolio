type PaymentChallenge = {
  extensions?: Record<string, unknown>;
  accepts?: Array<{ payTo?: string }>;
};

type DiscoveryResource = {
  resource?: string;
};

type CatalogDiscovery = {
  items?: DiscoveryResource[];
};

type MerchantDiscovery = {
  resources?: DiscoveryResource[];
};

type SearchDiscovery = {
  resources?: DiscoveryResource[];
};

type ValidationResponse = {
  valid?: boolean;
  statusCode?: number | null;
  preflight?: Array<{ check?: string; passed?: boolean; severity?: string; detail?: string }>;
  simulation?: { outcome?: string; rejectionReason?: string };
  index?: { active?: boolean; lastCrawledAt?: string | null } | null;
};

const baseUrl = (process.env.WALLETLENS_BASE_URL || "https://walletlens.wallyweb.com").replace(/\/+$/, "");
const demoAddress = process.env.WALLETLENS_DISCOVERY_TEST_ADDRESS || "0x52E29e0d2Aa49bfBfC548C0A9F2196F4aa51f3ea";
const robinhoodAddress = "0xfac1d7dC76bE90C5Cadd5B022af7838dd8190F16";
const timeoutMs = 20_000;
const paidUrls = [
  buildPaidUrl("/wallet-report", demoAddress, "base", { limit: "1" }),
  buildPaidUrl("/portfolio", robinhoodAddress, "robinhood"),
  buildPaidUrl("/tx-history", demoAddress, "base", { limit: "1" })
];

const challengeResponse = await fetch(paidUrls[0], { signal: AbortSignal.timeout(timeoutMs) });
if (challengeResponse.status !== 402) {
  throw new Error(`Expected ${paidUrls[0].origin}/wallet-report to return HTTP 402, received ${challengeResponse.status}.`);
}

const paymentRequiredHeader =
  challengeResponse.headers.get("payment-required") || challengeResponse.headers.get("x-payment-required");
if (!paymentRequiredHeader) throw new Error("The WalletLens 402 response did not include a payment-required header.");

const challenge = JSON.parse(Buffer.from(paymentRequiredHeader, "base64url").toString("utf8")) as PaymentChallenge;
const hasBazaarExtension = Boolean(challenge.extensions?.bazaar);
const payTo = challenge.accepts?.[0]?.payTo;
if (!payTo) throw new Error("The WalletLens payment challenge did not include a payTo address.");

const discoveryBaseUrl = "https://api.cdp.coinbase.com/platform/v2/x402";
const catalogUrl = new URL(`${discoveryBaseUrl}/discovery/resources`);
catalogUrl.searchParams.set("limit", "1000");
const merchantUrl = new URL(`${discoveryBaseUrl}/discovery/merchant`);
merchantUrl.searchParams.set("payTo", payTo);
merchantUrl.searchParams.set("limit", "100");
const searchUrl = new URL(`${discoveryBaseUrl}/discovery/search`);
searchUrl.searchParams.set(
  "query",
  "WalletLens EVM wallet report portfolio transaction history Robinhood Stock Tokens RWA"
);
searchUrl.searchParams.set("limit", "20");

const [catalogResponse, merchantResponse, searchResponse, validations] = await Promise.all([
  fetch(catalogUrl, { signal: AbortSignal.timeout(timeoutMs) }),
  fetch(merchantUrl, { signal: AbortSignal.timeout(timeoutMs) }),
  fetch(searchUrl, { signal: AbortSignal.timeout(timeoutMs) }),
  Promise.all(paidUrls.map(validateEndpoint))
]);
const catalog = (catalogResponse.ok ? await catalogResponse.json() : {}) as CatalogDiscovery;
const merchant = (merchantResponse.ok ? await merchantResponse.json() : {}) as MerchantDiscovery;
const search = (searchResponse.ok ? await searchResponse.json() : {}) as SearchDiscovery;
const catalogMatches = (catalog.items ?? []).filter(isWalletLensResource).length;
const merchantMatches = (merchant.resources ?? []).filter(isWalletLensResource).length;
const searchMatches = (search.resources ?? []).filter(isWalletLensResource).length;
const validationAccepted = validations.every(item => item.valid && item.simulationOutcome === "accepted");
const indexed = catalogMatches > 0 || merchantMatches > 0 || searchMatches > 0 || validations.some(item => item.indexed);

console.log(
  JSON.stringify(
    {
      ok: hasBazaarExtension && validationAccepted && indexed,
      service: baseUrl,
      paymentChallenge: {
        status: challengeResponse.status,
        hasBazaarExtension
      },
      validation: validations,
      cdpBazaar: {
        catalogMatches,
        merchantMatches,
        searchMatches
      },
      nextStep: indexed
        ? "WalletLens is indexed in the CDP Bazaar."
        : validationAccepted
          ? "All routes are accepted by CDP validation but remain unindexed. Check CloudWatch for bazaar:processing settle responses, then send the validation and settlement evidence to CDP support."
          : "Fix rejected validation checks before attempting another settlement."
    },
    null,
    2
  )
);

if (!hasBazaarExtension || !validationAccepted || !indexed) process.exitCode = 1;

function buildPaidUrl(
  path: string,
  address: string,
  chains: string,
  extra: Record<string, string> = {}
) {
  const url = new URL(`${baseUrl}${path}`);
  url.searchParams.set("address", address);
  url.searchParams.set("chains", chains);
  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
  return url;
}

async function validateEndpoint(resource: URL) {
  const response = await fetch(`${discoveryBaseUrl}/validate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ resource: resource.toString(), method: "GET" }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const body = (response.ok ? await response.json() : {}) as ValidationResponse;
  return {
    resource: resource.pathname,
    httpStatus: response.status,
    valid: body.valid === true,
    endpointStatus: body.statusCode ?? null,
    simulationOutcome: body.simulation?.outcome ?? null,
    rejectionReason: body.simulation?.rejectionReason ?? null,
    indexed: body.index?.active === true,
    lastCrawledAt: body.index?.lastCrawledAt ?? null,
    failedChecks: (body.preflight ?? [])
      .filter(check => !check.passed)
      .map(check => ({ check: check.check, severity: check.severity, detail: check.detail }))
  };
}

function isWalletLensResource(resource: DiscoveryResource) {
  return typeof resource.resource === "string" && resource.resource.startsWith(baseUrl);
}
