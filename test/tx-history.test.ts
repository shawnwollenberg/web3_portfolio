import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AssetTransfersCategory } from "alchemy-sdk";
import { categorizeTransaction } from "../src/tx-history.js";

describe("categorizeTransaction", () => {
  it("categorizes ERC20 transfers", () => {
    assert.deepEqual(
      categorizeTransaction({
        category: AssetTransfersCategory.ERC20,
        asset: "USDC",
        value: 1
      }),
      { type: "token_transfer", protocol: "Token" }
    );
  });

  it("categorizes native ETH transfers", () => {
    assert.deepEqual(
      categorizeTransaction({
        category: AssetTransfersCategory.EXTERNAL,
        asset: "ETH",
        value: 0.01
      }),
      { type: "native_transfer", protocol: "Native" }
    );
  });
});
