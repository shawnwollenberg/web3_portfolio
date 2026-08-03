import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseChains } from "../src/chains.js";

describe("Robinhood Chain selection", () => {
  it("maps Robinhood Chain to its Alchemy and CAIP-2 identifiers", () => {
    const [chain] = parseChains("robinhood");
    assert.equal(chain.slug, "robinhood");
    assert.equal(chain.label, "Robinhood Chain");
    assert.equal(chain.alchemyNetwork, "robinhood-mainnet");
    assert.equal(chain.caip2, "eip155:4663");
    assert.equal(chain.supportsInternalTransfers, false);
  });

  it("accepts aliases and deduplicates them", () => {
    const chains = parseChains("robinhood-chain,rh,robinhood");
    assert.deepEqual(chains.map(chain => chain.slug), ["robinhood"]);
  });

  it("supports selecting all six canonical chain slugs", () => {
    const chains = parseChains("base,ethereum,optimism,arbitrum,polygon,robinhood");
    assert.equal(chains.length, 6);
  });
});
