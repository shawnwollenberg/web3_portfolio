import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

type HexPrivateKey = `0x${string}`;
type TestEndpoint = "portfolio" | "tx-history" | "wallet-report";

const privateKey = normalizePrivateKey(process.env.X402_TEST_PRIVATE_KEY);
const cliArgs = parseArgs(process.argv.slice(2));
const testEndpoint = parseEndpoint(
  cliArgs.endpoint || cliArgs.resource || process.env.X402_TEST_ENDPOINT || endpointFromUrl(process.env.X402_TEST_URL)
);
const baseUrl = (cliArgs.baseUrl || process.env.X402_TEST_BASE_URL || "https://walletlens.wallyweb.com").replace(/\/+$/, "");
const endpointUrl = cliArgs.url || getEndpointUrl(testEndpoint, baseUrl);
const address =
  cliArgs.address ||
  process.env.X402_TEST_ADDRESS ||
  (testEndpoint === "tx-history" || testEndpoint === "wallet-report"
    ? "0x52E29e0d2Aa49bfBfC548C0A9F2196F4aa51f3ea"
    : "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
const chains =
  cliArgs.chains ||
  process.env.X402_TEST_CHAINS ||
  (testEndpoint === "tx-history" || testEndpoint === "wallet-report" ? "base" : "base,ethereum");
const url = new URL(endpointUrl);

url.searchParams.set("address", address);
url.searchParams.set("chains", chains);

if (testEndpoint === "tx-history" || testEndpoint === "wallet-report") {
  url.searchParams.set("limit", cliArgs.limit || process.env.X402_TEST_LIMIT || "20");
  url.searchParams.set("days", cliArgs.days || process.env.X402_TEST_DAYS || "30");
  url.searchParams.set("category", cliArgs.category || process.env.X402_TEST_CATEGORY || "all");
}

if (!privateKey) {
  fail(
    [
      "X402_TEST_PRIVATE_KEY is required.",
      "Add it to .env as X402_TEST_PRIVATE_KEY=0x...",
      "Use a dedicated test wallet funded with Base USDC for the $0.02 payment."
    ].join("\n")
  );
}

const account = privateKeyToAccount(privateKey);
const coreClient = new x402Client();
registerExactEvmScheme(coreClient, { signer: account });

const client = new x402HTTPClient(coreClient);

console.log(`WalletLens x402 paid-call test`);
console.log(`endpoint: ${testEndpoint}`);
console.log(`payer: ${account.address}`);
console.log(`url: ${url.toString()}`);

const initialResponse = await fetch(url);

if (initialResponse.status !== 402) {
  const body = await readResponseBody(initialResponse);
  fail(`Expected initial HTTP 402, got ${initialResponse.status}\n${body}`);
}

const paymentRequired = client.getPaymentRequiredResponse(
  name => initialResponse.headers.get(name),
  await tryReadJson(initialResponse)
);

const selectedRequirement = paymentRequired.accepts[0];
if (!selectedRequirement) {
  fail("Server returned HTTP 402 without payment requirements.");
}

console.log("payment required:");
console.log(`  network: ${selectedRequirement.network}`);
console.log(`  asset: ${selectedRequirement.asset}`);
console.log(`  amount: ${selectedRequirement.amount}`);
console.log(`  payTo: ${selectedRequirement.payTo}`);
console.log(`  resource: ${paymentRequired.resource.url}`);

const paymentPayload = await client.createPaymentPayload(paymentRequired);
const paymentHeaders = client.encodePaymentSignatureHeader(paymentPayload);

console.log("payment payload created; retrying paid request...");

const paidResponse = await fetch(url, {
  headers: paymentHeaders
});

const paidBody = await readResponseBody(paidResponse);

if (!paidResponse.ok) {
  fail(`Paid request failed with HTTP ${paidResponse.status}\n${paidBody}`);
}

const settlement = tryGetSettlement(client, paidResponse);
if (settlement) {
  console.log("settlement response:");
  console.log(JSON.stringify(settlement, null, 2));
} else {
  console.log("settlement response header was not present.");
}

console.log(`${testEndpoint} response:`);
console.log(JSON.stringify(JSON.parse(paidBody), null, 2));

function parseArgs(args: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const value = inlineValue ?? args[index + 1];
    if (inlineValue === undefined) index += 1;

    parsed[rawKey] = value;
  }

  return parsed;
}

function parseEndpoint(value: string | undefined): TestEndpoint {
  if (!value || value === "portfolio") return "portfolio";
  if (value === "tx-history" || value === "tx" || value === "txlens") return "tx-history";
  if (value === "wallet-report" || value === "report") return "wallet-report";
  fail(`Unsupported endpoint "${value}". Use --endpoint portfolio, --endpoint tx-history, or --endpoint wallet-report.`);
}

function endpointFromUrl(value: string | undefined): TestEndpoint | undefined {
  if (!value) return undefined;
  try {
    const path = new URL(value).pathname;
    if (path.endsWith("/tx-history")) return "tx-history";
    if (path.endsWith("/wallet-report")) return "wallet-report";
    if (path.endsWith("/portfolio")) return "portfolio";
  } catch {
    return undefined;
  }
  return undefined;
}

function getEndpointUrl(endpoint: TestEndpoint, baseUrl: string): string {
  if (!process.env.X402_TEST_URL) return `${baseUrl}/${endpoint}`;

  const envEndpoint = endpointFromUrl(process.env.X402_TEST_URL);
  if (envEndpoint === endpoint) return process.env.X402_TEST_URL;

  return `${baseUrl}/${endpoint}`;
}

function normalizePrivateKey(value: string | undefined): HexPrivateKey | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const withPrefix = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;

  if (!/^0x[a-fA-F0-9]{64}$/.test(withPrefix)) {
    fail("X402_TEST_PRIVATE_KEY must be a 32-byte hex private key, with or without 0x prefix.");
  }

  return withPrefix as HexPrivateKey;
}

async function tryReadJson(response: Response): Promise<unknown | undefined> {
  const text = await response.text();
  if (!text) return undefined;

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function readResponseBody(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return "";

  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function tryGetSettlement(client: x402HTTPClient, response: Response) {
  try {
    return client.getPaymentSettleResponse(name => response.headers.get(name));
  } catch {
    return null;
  }
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
