/**
 * Aegis x402 pre-authorization helper (bot-signed, owner-key-free).
 *
 * Aegis smart accounts (`AgentSmartAccount`) enforce policy on x402 payments via a
 * GATED EIP-1271 implementation: `isValidSignature(digest, sig)` returns the magic
 * value ONLY when the exact EIP-3009 digest has first been authorized on-chain by
 * `authorizeX402Payment(...)`. A vanilla x402 client (sign EIP-3009 -> POST to
 * facilitator) skips this, so the facilitator's EIP-1271 check fails and the resource
 * returns a 402 with an empty body before any funds move. This helper performs the
 * missing step WITHOUT the owner key.
 *
 * How it stays owner-key-free: `authorizeX402Payment` is `onlyOwnerOrEntryPoint`. We
 * submit it as an ERC-4337 v0.6 UserOperation whose callData IS authorizeX402Payment,
 * signed by the BOT signer. `validateUserOp` only runs policy checks for execute()/
 * executeBatch() selectors, so it just verifies the bot signature here; the EntryPoint
 * then becomes msg.sender and the call passes onlyOwnerOrEntryPoint. The Aegis backend
 * relays the signed op via EntryPoint.handleOps and sponsors gas (it is a dumb relay
 * with no authority over funds — tampering breaks the signature).
 *
 * Two-key model:
 *   - owner  = the connected wallet. NOT needed at runtime by this flow.
 *   - signer = the bot EOA. Signs the UserOp AND the EIP-3009 authorization.
 */
import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getUserOperationHash } from "viem/account-abstraction";
import { base, baseSepolia, sepolia } from "viem/chains";

/** EntryPoint v0.6 (the version Aegis accounts target). */
export const ENTRY_POINT_V06: Address = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";

export const AUTHORIZE_X402_ABI = [
  {
    type: "function",
    name: "authorizeX402Payment",
    stateMutability: "nonpayable",
    inputs: [
      { name: "permissionId", type: "bytes32" },
      { name: "token", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
    outputs: [{ name: "digest", type: "bytes32" }],
  },
  { type: "function", name: "signer", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "enforcementMode", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

const ENTRY_POINT_ABI = [
  {
    type: "function",
    name: "getNonce",
    stateMutability: "view",
    inputs: [{ name: "sender", type: "address" }, { name: "key", type: "uint192" }],
    outputs: [{ name: "nonce", type: "uint256" }],
  },
] as const;

/** The EIP-3009 authorization tuple the x402 client generated (payload.authorization + the asset). */
export type X402Authorization = {
  to: Address;
  value: string | bigint;
  validAfter: string | bigint;
  validBefore: string | bigint;
  nonce: Hex;
};

export function resolveChain(network: string): Chain {
  const n = network.toLowerCase();
  if (n.includes("8453") || n === "base") return base;
  if (n.includes("84532") || n.includes("base-sepolia")) return baseSepolia;
  if (n.includes("11155111") || n === "sepolia") return sepolia;
  throw new Error(`Unsupported x402 network "${network}".`);
}

/** Read signer()/enforcementMode so callers can sanity-check the bot key. */
export async function readAccountKeys(client: PublicClient, smartAccount: Address) {
  const [signer, enforcementMode] = await Promise.all([
    client.readContract({ address: smartAccount, abi: AUTHORIZE_X402_ABI, functionName: "signer" }),
    client.readContract({ address: smartAccount, abi: AUTHORIZE_X402_ABI, functionName: "enforcementMode" }),
  ]);
  return { signer: signer as Address, enforcementMode: Number(enforcementMode) };
}

export type RelayResult = { txHash: Hex; token?: string; to?: string; value?: string };

/**
 * Pre-authorize an x402 payment on the Aegis smart account, owner-key-free, by relaying
 * a bot-signed authorizeX402Payment UserOperation through the Aegis backend.
 *
 * Pass the SAME (to, value, validAfter, validBefore, nonce) the x402 client put in
 * `paymentPayload.payload.authorization`, plus the token (= requirement.asset).
 */
export async function relayX402Authorization(opts: {
  botSignerPrivateKey: Hex;
  rpcUrl: string;
  network: string | Chain;
  smartAccount: Address;
  permissionId: Hex;
  token: Address;
  authorization: X402Authorization;
  /** Aegis API base, e.g. https://api.projectaegis.ai */
  aegisApiBaseUrl: string;
  /** Aegis API key (X-API-Key) for the wallet that owns the agent. */
  aegisApiKey: string;
  agentId: string;
  entryPoint?: Address;
  /** Skip the signer() sanity read. Default false. */
  skipPreflight?: boolean;
}): Promise<RelayResult> {
  const chain = typeof opts.network === "string" ? resolveChain(opts.network) : opts.network;
  const entryPoint = opts.entryPoint ?? ENTRY_POINT_V06;
  const bot = privateKeyToAccount(opts.botSignerPrivateKey);
  const smartAccount = getAddress(opts.smartAccount);
  const pub = createPublicClient({ chain, transport: http(opts.rpcUrl) });

  if (!opts.skipPreflight) {
    const keys = await readAccountKeys(pub, smartAccount);
    if (keys.signer.toLowerCase() !== bot.address.toLowerCase()) {
      throw new Error(
        [
          "botSignerPrivateKey is not this account's signer().",
          `  account.signer(): ${keys.signer}`,
          `  provided signer:  ${bot.address}`,
          "isValidSignature (and the UserOp) verify against signer() — use the bot key the account was deployed with.",
        ].join("\n"),
      );
    }
    if (keys.enforcementMode === 1) {
      throw new Error("Account is MODE_INTENT_ONLY (no enforcer); authorizeX402Payment reverts. Use MODE_BOTH or MODE_POLICY_ONLY.");
    }
  }

  // callData = authorizeX402Payment(tuple) — the account calls itself via the EntryPoint.
  const callData = encodeFunctionData({
    abi: AUTHORIZE_X402_ABI,
    functionName: "authorizeX402Payment",
    args: [
      opts.permissionId,
      getAddress(opts.token),
      getAddress(opts.authorization.to),
      BigInt(opts.authorization.value),
      BigInt(opts.authorization.validAfter),
      BigInt(opts.authorization.validBefore),
      opts.authorization.nonce,
    ],
  });

  const [nonce, fees] = await Promise.all([
    pub.readContract({ address: entryPoint, abi: ENTRY_POINT_ABI, functionName: "getNonce", args: [smartAccount, 0n] }),
    pub.estimateFeesPerGas(),
  ]);

  // Conservative v0.6 gas limits for a single authorize call (enforcer check + record).
  const userOperation = {
    sender: smartAccount,
    nonce: nonce as bigint,
    initCode: "0x" as Hex,
    callData,
    callGasLimit: 300_000n,
    verificationGasLimit: 250_000n,
    preVerificationGas: 80_000n,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    paymasterAndData: "0x" as Hex,
    signature: "0x" as Hex,
  };

  const userOpHash = getUserOperationHash({
    chainId: chain.id,
    entryPointAddress: entryPoint,
    entryPointVersion: "0.6",
    userOperation,
  });

  // Bot signs the userOpHash as an EIP-191 personal_sign message (matches the contract's
  // \x19Ethereum Signed Message prefix in _validateSignature).
  const signature = await bot.signMessage({ message: { raw: userOpHash } });

  const body = {
    sender: userOperation.sender,
    nonce: userOperation.nonce.toString(),
    init_code: userOperation.initCode,
    call_data: userOperation.callData,
    call_gas_limit: userOperation.callGasLimit.toString(),
    verification_gas_limit: userOperation.verificationGasLimit.toString(),
    pre_verification_gas: userOperation.preVerificationGas.toString(),
    max_fee_per_gas: userOperation.maxFeePerGas.toString(),
    max_priority_fee_per_gas: userOperation.maxPriorityFeePerGas.toString(),
    paymaster_and_data: userOperation.paymasterAndData,
    signature,
  };

  const url = `${opts.aegisApiBaseUrl.replace(/\/+$/, "")}/api/v1/agents/${opts.agentId}/x402/relay`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": opts.aegisApiKey },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Aegis relay failed (HTTP ${res.status}): ${text}`);
  }
  // Backend responds in snake_case ({ tx_hash, token, to, value }); normalize to camelCase.
  const data = JSON.parse(text) as { tx_hash?: string; token?: string; to?: string; value?: string };
  if (!data.tx_hash) {
    throw new Error(`Aegis relay returned no tx_hash: ${text}`);
  }
  return { txHash: data.tx_hash as Hex, token: data.token, to: data.to, value: data.value };
}
