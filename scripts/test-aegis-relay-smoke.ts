/**
 * Aegis x402 relay smoke test (no x402 merchant required).
 *
 * Proves the novel, owner-key-free mechanism end-to-end on any chain:
 *   bot-signed authorizeX402Payment UserOp -> Aegis backend relay -> EntryPoint ->
 *   on-chain authorizeX402Payment (policy check + usage record + digest authorized),
 *   gas-sponsored, no owner key.
 *
 * It does NOT call a facilitator. It builds a real EIP-3009 authorization tuple
 * (to/value/validAfter/validBefore/nonce) for the policy-allowed token, relays the
 * authorize op, and confirms the X402PaymentAuthorized event in the receipt.
 *
 * Required env (or --flags):
 *   AEGIS_API_BASE_URL          e.g. https://api.projectaegis.ai
 *   AEGIS_API_KEY               API key for the wallet that owns the agent
 *   AEGIS_AGENT_ID              the agent's uuid
 *   X402_SMART_ACCOUNT_ADDRESS  the agent's deployed smart account
 *   X402_SMART_ACCOUNT_SIGNER_PRIVATE_KEY   the bot signer key
 *   X402_AEGIS_PERMISSION_ID    the minted permission id (bytes32)
 *   SMOKE_TOKEN                 a token the policy allows (e.g. Sepolia USDC)
 *   SMOKE_VALUE                 raw base-unit amount within the per-tx cap (e.g. 1000000 = 1 USDC@6dp)
 *   SMOKE_RPC_URL               chain RPC (defaults to Sepolia public)
 *   SMOKE_NETWORK               base | base-sepolia | sepolia (default sepolia)
 *   SMOKE_PAY_TO                optional recipient (defaults to the smart account itself)
 */
import { createPublicClient, getAddress, http, parseEventLogs, type Hex } from "viem";
import { relayX402Authorization } from "./aegis-x402.js";

const args = parseArgs(process.argv.slice(2));
const env = (k: string) => (process.env[k] || "").trim();

const apiBaseUrl = args.aegisApi || env("AEGIS_API_BASE_URL");
const apiKey = args.aegisApiKey || env("AEGIS_API_KEY");
const agentId = args.agentId || env("AEGIS_AGENT_ID");
const smartAccount = (args.smartAccount || env("X402_SMART_ACCOUNT_ADDRESS")) as Hex;
const botKey = (args.botKey || env("X402_SMART_ACCOUNT_SIGNER_PRIVATE_KEY")) as Hex;
const permissionId = (args.permissionId || env("X402_AEGIS_PERMISSION_ID")) as Hex;
const token = (args.token || env("SMOKE_TOKEN")) as Hex;
const value = args.value || env("SMOKE_VALUE");
const rpcUrl = args.rpcUrl || env("SMOKE_RPC_URL") || "https://ethereum-sepolia-rpc.publicnode.com";
const network = args.network || env("SMOKE_NETWORK") || "sepolia";
const payTo = (args.payTo || env("SMOKE_PAY_TO") || smartAccount) as Hex;

for (const [k, v] of Object.entries({ apiBaseUrl, apiKey, agentId, smartAccount, botKey, permissionId, token, value })) {
  if (!v) fail(`missing required input: ${k}`);
}
if (!/^0x[a-fA-F0-9]{64}$/.test(permissionId)) fail("X402_AEGIS_PERMISSION_ID must be a 32-byte hex value");

const X402_AUTHORIZED_EVENT = [{
  type: "event", name: "X402PaymentAuthorized",
  inputs: [
    { name: "agentId", type: "bytes32", indexed: true },
    { name: "token", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false },
    { name: "digest", type: "bytes32", indexed: false },
  ],
}] as const;

// A unique 32-byte nonce so the digest is fresh each run (avoids DigestAlreadyAuthorized).
function randomNonce(): Hex {
  let h = "0x";
  // Math.random is fine for a test nonce; not security-sensitive.
  for (let i = 0; i < 64; i++) h += Math.floor(Math.random() * 16).toString(16);
  return h as Hex;
}

const now = Math.floor(Date.now() / 1000);
const authorization = {
  to: getAddress(payTo),
  value: String(value),
  validAfter: String(now - 600),
  validBefore: String(now + 3600),
  nonce: randomNonce(),
};

console.log("Aegis x402 relay smoke test");
console.log(`network:        ${network}`);
console.log(`smart account:  ${smartAccount}`);
console.log(`token:          ${token}`);
console.log(`value (raw):    ${value}`);
console.log(`relay:          ${apiBaseUrl}/api/v1/agents/${agentId}/x402/relay`);

const result = await relayX402Authorization({
  botSignerPrivateKey: botKey,
  rpcUrl,
  network,
  smartAccount,
  permissionId,
  token,
  authorization,
  aegisApiBaseUrl: apiBaseUrl,
  aegisApiKey: apiKey,
  agentId,
});

console.log(`relayed. tx_hash=${result.txHash}`);

// Verify the on-chain authorization event.
const pub = createPublicClient({ transport: http(rpcUrl) });
const receipt = await pub.waitForTransactionReceipt({ hash: result.txHash as Hex });
const events = parseEventLogs({ abi: X402_AUTHORIZED_EVENT, logs: receipt.logs });
const authed = events.find((e) => e.address.toLowerCase() === smartAccount.toLowerCase());

if (!authed) {
  fail(`tx ${result.txHash} mined (status ${receipt.status}) but no X402PaymentAuthorized event from ${smartAccount}. ` +
    "The op may have reverted post-validation, or policy rejected it.");
}

console.log("PASS — X402PaymentAuthorized emitted on-chain:");
console.log(`  token:  ${(authed as any).args.token}`);
console.log(`  to:     ${(authed as any).args.to}`);
console.log(`  value:  ${(authed as any).args.value}`);
console.log(`  digest: ${(authed as any).args.digest}`);
console.log("The bot-signed UserOp authorized the payment on-chain with no owner key and sponsored gas.");

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const [rawKey, inline] = a.slice(2).split("=", 2);
    const val = inline ?? argv[i + 1];
    if (inline === undefined) i += 1;
    out[rawKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = val;
  }
  return out;
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}
