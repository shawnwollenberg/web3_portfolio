import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";

export const BASE_MAINNET = "eip155:8453";
export const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

export type WalletLensPaymentPolicy = {
  baseUrl: string;
  expectedPath: string;
  maxAmountAtomic: bigint;
  expectedPayTo?: string;
};

export function parseUsdcAmountToAtomic(value: string): bigint {
  const match = value.trim().match(/^(\d+)(?:\.(\d{0,6}))?$/);
  if (!match) throw new Error("WALLETLENS_MAX_PAYMENT_USDC must be a non-negative decimal with at most 6 places.");

  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(6, "0") || "0");
  return whole * 1_000_000n + fraction;
}

export function filterSafePaymentRequirements(
  requirements: PaymentRequirements[],
  policy: WalletLensPaymentPolicy
): PaymentRequirements[] {
  return requirements.filter(requirement => {
    if (requirement.scheme !== "exact") return false;
    if (requirement.network !== BASE_MAINNET) return false;
    if (requirement.asset.toLowerCase() !== BASE_USDC) return false;
    if (!/^\d+$/.test(requirement.amount) || BigInt(requirement.amount) > policy.maxAmountAtomic) return false;
    if (policy.expectedPayTo && requirement.payTo.toLowerCase() !== policy.expectedPayTo.toLowerCase()) return false;
    return true;
  });
}

export function assertSafePaymentRequired(paymentRequired: PaymentRequired, policy: WalletLensPaymentPolicy): void {
  const expectedBaseUrl = new URL(policy.baseUrl);
  const resourceUrl = new URL(paymentRequired.resource.url);

  if (resourceUrl.origin !== expectedBaseUrl.origin || resourceUrl.pathname !== policy.expectedPath) {
    throw new Error(
      `Refusing x402 payment for unexpected resource ${resourceUrl.origin}${resourceUrl.pathname}; expected ${expectedBaseUrl.origin}${policy.expectedPath}.`
    );
  }

  if (filterSafePaymentRequirements(paymentRequired.accepts, policy).length === 0) {
    throw new Error(
      `Refusing x402 payment: no requirement matched exact Base USDC within the configured ${policy.maxAmountAtomic} atomic-unit limit.`
    );
  }
}
