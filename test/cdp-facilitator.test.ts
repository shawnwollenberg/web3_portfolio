import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveFacilitatorEndpoints } from "../src/cdp-facilitator.js";

describe("CDP facilitator auth paths", () => {
  it("binds verify, settle, and supported JWTs to the CDP v2 facilitator", () => {
    const endpoints = resolveFacilitatorEndpoints("https://api.cdp.coinbase.com/platform/v2/x402/");
    assert.equal(endpoints.host, "api.cdp.coinbase.com");
    assert.equal(endpoints.paths.verify, "/platform/v2/x402/verify");
    assert.equal(endpoints.paths.settle, "/platform/v2/x402/settle");
    assert.equal(endpoints.paths.supported, "/platform/v2/x402/supported");
  });
});