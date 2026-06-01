import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount, toAccount } from "viem/accounts";
import type { LocalAccount } from "viem";
import { relayX402Authorization } from "./aegis-x402.js";

type HexAddress = `0x${string}`;
type HexPrivateKey = `0x${string}`;
type TestEndpoint = "portfolio" | "tx-history" | "wallet-report";

const cliArgs = parseArgs(process.argv.slice(2));

const smartAccountAddress = normalizeAddress(
  cliArgs.smartAccount ||
    cliArgs.smartAccountAddress ||
    process.env.X402_SMART_ACCOUNT_ADDRESS,
  "smart account address"
);

const botSignerPrivateKey = normalizePrivateKey(
  cliArgs.botSignerKey ||
    cliArgs.signerKey ||
    process.env.X402_SMART_ACCOUNT_SIGNER_PRIVATE_KEY ||
    process.env.X402_SMART_ACCOUNT_BOT_PRIVATE_KEY
);

const entryPoint = normalizeAddress(
  cliArgs.entryPoint ||
    process.env.X402_SMART_ACCOUNT_ENTRY_POINT ||
    // Aegis accounts use EntryPoint v0.6. (Unused by the EIP-3009/EIP-1271 x402 path;
    // only relevant if you submit authorize as a UserOp via a bundler.)
    "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
  "entry point address"
);

// --- Aegis pre-authorization (bot-signed, relayed by the Aegis backend) -----
// Aegis smart accounts gate isValidSignature on an on-chain authorizeX402Payment
// call. We relay it as a bot-signed UserOp via the Aegis backend (gas-sponsored,
// owner key never needed). Without it the facilitator's EIP-1271 check fails -> 402.
const aegisPermissionId = (cliArgs.permissionId || process.env.X402_AEGIS_PERMISSION_ID || "").trim();
const aegisApiBaseUrl = (cliArgs.aegisApi || process.env.AEGIS_API_BASE_URL || "").trim();
const aegisApiKey = (cliArgs.aegisApiKey || process.env.AEGIS_API_KEY || "").trim();
const aegisAgentId = (cliArgs.agentId || process.env.AEGIS_AGENT_ID || "").trim();
const baseRpcUrl =
  cliArgs.rpcUrl || process.env.X402_BASE_RPC_URL || process.env.BASE_RPC_URL || "https://mainnet.base.org";
const aegisRelayReady = Boolean(aegisPermissionId && aegisApiBaseUrl && aegisApiKey && aegisAgentId);

const testEndpoint = parseEndpoint(
  cliArgs.endpoint ||
    cliArgs.resource ||
    process.env.X402_TEST_ENDPOINT ||
    endpointFromUrl(process.env.X402_TEST_URL)
);
const baseUrl = (cliArgs.baseUrl || process.env.X402_TEST_BASE_URL || "https://walletlens.wallyweb.com").replace(
  /\/+$/,
  ""
);
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

if (!smartAccountAddress) {
  fail(
    [
      "X402_SMART_ACCOUNT_ADDRESS is required.",
      "Add it to .env as X402_SMART_ACCOUNT_ADDRESS=0x...",
      "This is the deployed ERC-4337 smart account that owns the Base USDC used for x402 payments."
    ].join("\n")
  );
}

if (!botSignerPrivateKey) {
  fail(
    [
      "X402_SMART_ACCOUNT_SIGNER_PRIVATE_KEY is required.",
      "Add it to .env as X402_SMART_ACCOUNT_SIGNER_PRIVATE_KEY=0x...",
      "This is the bot signer EOA authorized by the smart account's EIP-1271 isValidSignature implementation."
    ].join("\n")
  );
}

const botSigner = privateKeyToAccount(botSignerPrivateKey);
const smartAccount = buildSmartAccountSigner({
  smartAccountAddress,
  botSigner
});

const coreClient = new x402Client();
registerExactEvmScheme(coreClient, { signer: smartAccount });
const client = new x402HTTPClient(coreClient);

console.log("WalletLens x402 paid-call test (ERC-4337 smart account)");
console.log(`endpoint:       ${testEndpoint}`);
console.log(`smart account:  ${smartAccount.address}`);
console.log(`bot signer:     ${botSigner.address}`);
console.log(`entry point:    ${entryPoint}`);
console.log(`aegis pre-auth: ${aegisRelayReady ? "enabled (bot-signed, backend-relayed)" : "DISABLED — see warning below"}`);
console.log(`url:            ${url.toString()}`);

const initialResponse = await fetchInitialPaymentRequired(url);

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
console.log(`  network:  ${selectedRequirement.network}`);
console.log(`  asset:    ${selectedRequirement.asset}`);
console.log(`  amount:   ${selectedRequirement.amount}`);
console.log(`  payTo:    ${selectedRequirement.payTo}`);
console.log(`  resource: ${paymentRequired.resource.url}`);

const paymentPayload = await client.createPaymentPayload(paymentRequired);
const paymentHeaders = client.encodePaymentSignatureHeader(paymentPayload);

// Aegis gate: pre-authorize the exact EIP-3009 digest on-chain (owner-signed) BEFORE
// the facilitator verifies it via EIP-1271. Skipping this is the #1 cause of an empty 402.
const authorization = (paymentPayload as any)?.payload?.authorization as
  | { to: HexAddress; value: string; validAfter: string; validBefore: string; nonce: HexAddress }
  | undefined;

if (aegisRelayReady) {
  if (!authorization) {
    fail("Could not read payload.authorization from the x402 payment payload — cannot pre-authorize.");
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(aegisPermissionId)) {
    fail(`X402_AEGIS_PERMISSION_ID must be a 32-byte hex value (the minted permission id). Got: ${aegisPermissionId}`);
  }
  console.log("pre-authorizing x402 payment via Aegis backend relay (bot-signed UserOp, gas-sponsored)...");
  const result = await relayX402Authorization({
    botSignerPrivateKey: botSignerPrivateKey as HexPrivateKey,
    rpcUrl: baseRpcUrl,
    network: selectedRequirement.network,
    smartAccount: smartAccountAddress as HexAddress,
    permissionId: aegisPermissionId as HexAddress,
    token: selectedRequirement.asset as HexAddress,
    authorization: authorization!,
    aegisApiBaseUrl,
    aegisApiKey,
    agentId: aegisAgentId,
  });
  console.log(`  authorized on-chain via relay (tx ${result.txHash})`);
} else {
  console.log(
    [
      "WARNING: skipping Aegis on-chain pre-authorization. The facilitator's EIP-1271 check will",
      "fail and the paid request will return 402 with an empty body. Set X402_AEGIS_PERMISSION_ID,",
      "AEGIS_API_BASE_URL, AEGIS_API_KEY, and AEGIS_AGENT_ID to enable the bot-signed relay.",
    ].join("\n")
  );
}

console.log("payment payload signed by bot signer over the smart account's `from`; retrying paid request...");

const paidResponse = await fetch(url, { headers: paymentHeaders });
const paidBody = await readResponseBody(paidResponse);

if (!paidResponse.ok) {
  fail(
    [
      `Paid request failed with HTTP ${paidResponse.status}`,
      paidBody,
      "",
      "If you got a 402 with an empty body, the Aegis EIP-1271 gate rejected the signature.",
      "Checklist:",
      "  1. Did the bot-signed relay run? (set X402_AEGIS_PERMISSION_ID, AEGIS_API_BASE_URL,",
      "     AEGIS_API_KEY, AEGIS_AGENT_ID — see the 'aegis pre-auth' line in the banner.)",
      "  2. Is the bot signer key the account's signer()? (cast call <sa> \"signer()(address)\")",
      "  3. Does the active policy allow this token + amount? (a policy violation reverts the",
      "     relayed authorize op with X402PolicyViolation before you ever reach the facilitator.)",
      "  4. Is the smart account funded with the USDC being paid? (gas is sponsored by the relay.)"
    ].join("\n")
  );
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

async function fetchInitialPaymentRequired(target: URL): Promise<Response> {
  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(target);
    if (response.status !== 500 && response.status !== 502 && response.status !== 503) {
      return response;
    }
    if (attempt === maxAttempts) return response;

    const delayMs = 1500 * attempt;
    console.log(
      `initial request returned HTTP ${response.status} (likely Lambda cold-start x402 init failure); retrying in ${delayMs}ms (${attempt}/${maxAttempts - 1})...`
    );
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  throw new Error("unreachable");
}

function buildSmartAccountSigner(input: {
  smartAccountAddress: HexAddress;
  botSigner: ReturnType<typeof privateKeyToAccount>;
}): LocalAccount {
  const { smartAccountAddress, botSigner } = input;

  return toAccount({
    address: smartAccountAddress,
    async signMessage({ message }) {
      return botSigner.signMessage({ message });
    },
    async signTypedData(parameters) {
      return botSigner.signTypedData(parameters);
    },
    async signTransaction() {
      throw new Error(
        "Smart account cannot sign raw transactions. x402 settles via EIP-3009 + EIP-1271; " +
          "use the EntryPoint flow if you need to submit a UserOperation directly."
      );
    }
  });
}

function parseArgs(args: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const value = inlineValue ?? args[index + 1];
    if (inlineValue === undefined) index += 1;

    const camelKey = rawKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    parsed[camelKey] = value;
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
    fail("Smart account signer private key must be a 32-byte hex value, with or without 0x prefix.");
  }

  return withPrefix as HexPrivateKey;
}

function normalizeAddress(value: string | undefined, label: string): HexAddress | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
    fail(`${label} must be a 20-byte hex address with 0x prefix. Got: ${trimmed}`);
  }
  return trimmed as HexAddress;
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
