import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";

const address = "0x52E29e0d2Aa49bfBfC548C0A9F2196F4aa51f3ea";
let server: Server;
let baseUrl: string;

before(async () => {
  server = createApp().listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
});

describe("agent request validation", () => {
  it("rejects an unsupported chain from the free quote", async () => {
    const response = await fetch(`${baseUrl}/quote?address=${address}&chains=solana`);
    assert.equal(response.status, 400);
    const body = (await response.json()) as { details?: { fieldErrors?: { chains?: string[] } } };
    assert.match(body.details?.fieldErrors?.chains?.[0] ?? "", /Unsupported chain/);
  });

  it("does not produce a payable URL for an unsupported chain", async () => {
    const response = await fetch(`${baseUrl}/analyze?address=${address}&chains=solana`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { readyToPay: boolean; paidUrl: string | null };
    assert.equal(body.readyToPay, false);
    assert.equal(body.paidUrl, null);
  });

  it("produces a Robinhood Chain payable URL", async () => {
    const response = await fetch(`${baseUrl}/analyze?address=${address}&chains=robinhood`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { readyToPay: boolean; paidUrl: string | null };
    assert.equal(body.readyToPay, true);
    assert.match(body.paidUrl ?? "", /chains=robinhood/);
  });

  it("negotiates Robinhood reports with Bazaar discovery metadata", async () => {
    const response = await fetch(`${baseUrl}/portfolio?address=${address}&chains=robinhood`);
    assert.equal(response.status, 402);

    const paymentRequired = response.headers.get("payment-required");
    assert.ok(paymentRequired);
    const challenge = JSON.parse(Buffer.from(paymentRequired, "base64url").toString("utf8")) as {
      resource?: { url?: string; description?: string };
      extensions?: { bazaar?: unknown };
    };
    assert.equal(challenge.resource?.url, "https://walletlens.wallyweb.com/portfolio");
    assert.match(challenge.resource?.description ?? "", /Robinhood Stock Tokens/);
    assert.ok(challenge.extensions?.bazaar);
  });

  it("routes combined portfolio and transaction intent to the wallet report", async () => {
    const query = encodeURIComponent(`show portfolio balances and transaction history for ${address} on base`);
    const response = await fetch(`${baseUrl}/ask?q=${query}`);
    const body = (await response.json()) as { detected: { recommendedEndpoint: string } };
    assert.equal(body.detected.recommendedEndpoint, "/wallet-report");
  });

  it("advertises the published MCP package in agent discovery", async () => {
    const response = await fetch(`${baseUrl}/discover`);
    const body = (await response.json()) as {
      mcp?: { package?: string; run?: string; paidTools?: string[] };
    };

    assert.equal(response.status, 200);
    assert.equal(body.mcp?.package, "@shawnwollenberg/walletlens-mcp@0.1.2");
    assert.match(body.mcp?.run ?? "", /npx --yes/);
    assert.deepEqual(body.mcp?.paidTools, ["get_portfolio", "get_tx_history", "get_wallet_report"]);
  });

  it("rejects a missing paid-route address before payment middleware", async () => {
    const response = await fetch(`${baseUrl}/portfolio?chains=base`);
    assert.equal(response.status, 400);
  });

  it("serves local x402 catalogs on common agent discovery paths", async () => {
    for (const path of [
      "/v2/x402/discovery/resources",
      "/x402/discovery/resources",
      "/discovery/resources",
      "/.well-known/x402/discovery/resources",
      "/v1/x402/discovery/resources"
    ]) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        items?: Array<{ resource?: string; accepts?: Array<{ amount?: string; asset?: string }> }>;
        pagination?: { total?: number };
      };
      assert.equal(body.items?.length, 3);
      assert.equal(body.pagination?.total, 3);
      assert.ok(body.items?.some(item => item.resource?.endsWith("/wallet-report")));
      assert.equal(body.items?.[0]?.accepts?.[0]?.amount, "20000");
      assert.match(body.items?.[0]?.accepts?.[0]?.asset ?? "", /^0x[a-fA-F0-9]{40}$/);
    }
  });

  it("returns API catalog metadata on observed discovery aliases", async () => {
    for (const path of ["/.well-known/api-catalog", "/apis.json"]) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, 200);
      const body = (await response.json()) as { openapi?: string; mcp?: { name?: string }; robinhoodPreview?: string };
      assert.match(body.openapi ?? "", /openapi\.json$/);
      assert.equal(body.mcp?.name, "io.github.shawnwollenberg/walletlens");
      assert.match(body.robinhoodPreview ?? "", /preview\/robinhood$/);
    }
  });

  it("answers HEAD paid-route probes without requiring an address", async () => {
    const response = await fetch(`${baseUrl}/wallet-report`, { method: "HEAD" });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("allow"), "GET, HEAD");
    assert.equal(response.headers.get("x-walletlens-required-parameter"), "address");
  });

  it("guides POST clients to deterministic GET paid URLs", async () => {
    const response = await fetch(`${baseUrl}/wallet-report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address })
    });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET, HEAD");
    const body = (await response.json()) as { supportedMethod?: string; example?: string };
    assert.equal(body.supportedMethod, "GET");
    assert.match(body.example ?? "", /address=0x/);
  });
});
