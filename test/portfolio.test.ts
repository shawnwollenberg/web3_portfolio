import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatTokenAmount } from "../src/portfolio.js";

describe("formatTokenAmount", () => {
  it("formats integer token balances with decimals", () => {
    assert.equal(formatTokenAmount("1000000", 6), "1");
    assert.equal(formatTokenAmount("123456789", 6), "123.456789");
  });

  it("preserves non-integer provider values", () => {
    assert.equal(formatTokenAmount("1.5", 6), "1.5");
  });
});
