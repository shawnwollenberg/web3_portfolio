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
    assert.equal(body.mcp?.package, "@shawnwollenberg/walletlens-mcp@0.1.0");
    assert.match(body.mcp?.run ?? "", /npx --yes/);
    assert.deepEqual(body.mcp?.paidTools, ["get_portfolio", "get_tx_history", "get_wallet_report"]);
  });

  it("rejects a missing paid-route address before payment middleware", async () => {
    const response = await fetch(`${baseUrl}/portfolio?chains=base`);
    assert.equal(response.status, 400);
  });
});
