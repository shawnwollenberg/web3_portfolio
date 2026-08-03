import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { averageDecimalStrings, formatTokenAmount, multiplyDecimalStrings } from "../src/portfolio.js";

describe("formatTokenAmount", () => {
  it("formats integer token balances with decimals", () => {
    assert.equal(formatTokenAmount("1000000", 6), "1");
    assert.equal(formatTokenAmount("123456789", 6), "123.456789");
  });

  it("preserves non-integer provider values", () => {
    assert.equal(formatTokenAmount("1.5", 6), "1.5");
  });

  it("does not allocate from invalid token decimals", () => {
    assert.equal(formatTokenAmount("100", 1000), "100");
  });
});

describe("multiplyDecimalStrings", () => {
  it("multiplies without losing precision to JavaScript numbers", () => {
    assert.equal(multiplyDecimalStrings("9007199254740993", "1.25"), "11258999068426241.25");
    assert.equal(multiplyDecimalStrings("0.000001", "0.25"), "0");
  });

  it("rounds to six fractional digits and supports scientific notation", () => {
    assert.equal(multiplyDecimalStrings("1", "1.2345678"), "1.234568");
    assert.equal(multiplyDecimalStrings("100000000", "1e-8"), "1");
  });
});

describe("averageDecimalStrings", () => {
  it("preserves the extra decimal place required by half-unit midpoints", () => {
    assert.equal(averageDecimalStrings("0.1", "0.2"), "0.15");
    assert.equal(averageDecimalStrings("76", "79.63"), "77.815");
  });

  it("rounds only after calculating the exact midpoint", () => {
    assert.equal(averageDecimalStrings("1.0000001", "1.0000002"), "1");
  });
});
