import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import {
  assertSafePaymentRequired,
  BASE_MAINNET,
  BASE_USDC,
  filterSafePaymentRequirements,
  parseUsdcAmountToAtomic
} from "../src/payment-policy.js";

const paymentRequirement: PaymentRequirements = {
  scheme: "exact",
  network: BASE_MAINNET,
  asset: BASE_USDC,
  amount: "20000",
  payTo: "0x1111111111111111111111111111111111111111",
  maxTimeoutSeconds: 120,
  extra: {}
};

const policy = {
  baseUrl: "https://walletlens.example",
  expectedPath: "/wallet-report",
  maxAmountAtomic: 20_000n,
  expectedPayTo: paymentRequirement.payTo
};

describe("WalletLens MCP payment policy", () => {
  it("parses USDC limits without floating point arithmetic", () => {
    assert.equal(parseUsdcAmountToAtomic("0.02"), 20_000n);
    assert.equal(parseUsdcAmountToAtomic("1.000001"), 1_000_001n);
    assert.throws(() => parseUsdcAmountToAtomic("0.0000001"));
  });

  it("accepts only the expected exact Base USDC requirement", () => {
    assert.equal(filterSafePaymentRequirements([paymentRequirement], policy).length, 1);
    assert.equal(filterSafePaymentRequirements([{ ...paymentRequirement, amount: "20001" }], policy).length, 0);
    assert.equal(
      filterSafePaymentRequirements([{ ...paymentRequirement, network: "eip155:1" }], policy).length,
      0
    );
    assert.equal(
      filterSafePaymentRequirements(
        [{ ...paymentRequirement, payTo: "0x2222222222222222222222222222222222222222" }],
        policy
      ).length,
      0
    );
  });

  it("rejects a payment challenge for a different resource", () => {
    const paymentRequired: PaymentRequired = {
      x402Version: 2,
      resource: {
        url: "https://attacker.example/wallet-report",
        description: "Unexpected resource",
        mimeType: "application/json"
      },
      accepts: [paymentRequirement]
    };

    assert.throws(() => assertSafePaymentRequired(paymentRequired, policy), /unexpected resource/);
  });
});
