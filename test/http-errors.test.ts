import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isTimeoutError, providerError, toHttpError } from "../src/http-errors.js";

describe("http errors", () => {
  it("maps provider timeouts to a JSON 504", () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    assert.equal(isTimeoutError(timeout), true);

    const error = providerError("Alchemy portfolio token request timed out", { timeout: true });
    const httpError = toHttpError(error);
    assert.equal(httpError.status, 504);
    assert.equal(httpError.body.code, "provider_timeout");
    assert.match(String(httpError.body.message), /timed out/);
  });

  it("maps provider failures to a JSON 502 without treating them as timeouts", () => {
    const httpError = toHttpError(providerError("Alchemy portfolio token request failed: HTTP 429"));
    assert.equal(httpError.status, 502);
    assert.equal(httpError.body.code, "provider_error");
  });

  it("hides unexpected failures behind a stable JSON body", () => {
    const httpError = toHttpError(new Error("secret upstream detail"));
    assert.equal(httpError.status, 500);
    assert.equal(httpError.body.code, "internal_error");
    assert.equal(String(httpError.body.message).includes("secret"), false);
  });
});
