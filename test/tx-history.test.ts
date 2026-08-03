import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AssetTransfersCategory } from "../src/alchemy.js";
import { categorizeTransaction, isTimestampWithinLookback } from "../src/tx-history.js";

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

describe("isTimestampWithinLookback", () => {
  const now = Date.parse("2026-08-02T12:00:00.000Z");

  it("includes timestamps inside and on the lookback boundary", () => {
    assert.equal(isTimestampWithinLookback("2026-08-01T12:00:00.000Z", 2, now), true);
    assert.equal(isTimestampWithinLookback("2026-07-31T12:00:00.000Z", 2, now), true);
  });

  it("excludes old, missing, and invalid timestamps", () => {
    assert.equal(isTimestampWithinLookback("2026-07-31T11:59:59.999Z", 2, now), false);
    assert.equal(isTimestampWithinLookback(null, 2, now), false);
    assert.equal(isTimestampWithinLookback("not-a-date", 2, now), false);
  });
});
