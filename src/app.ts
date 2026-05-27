import express from "express";
import { z } from "zod";
import { analyticsMiddleware } from "./analytics.js";
import { config } from "./config.js";
import { getPortfolioSnapshot, type PortfolioSnapshot } from "./portfolio.js";
import { portfolioExample, txHistoryExample, walletReportExample } from "./schemas.js";
import { getTxHistorySnapshot } from "./tx-history.js";
import { getWalletReportSnapshot } from "./wallet-report.js";
import { createPaymentMiddleware, paymentRouteConfig } from "./x402.js";

const demoWallet = "0x52E29e0d2Aa49bfBfC548C0A9F2196F4aa51f3ea";
const ethExampleWallet = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const evmAddressPattern = /^0x[a-fA-F0-9]{40}$/;
const walletsToTry = [
  {
    label: "Base USDC demo wallet",
    address: demoWallet,
    chains: "base",
    prompt: "analyze this Base wallet and summarize holdings plus recent USDC transfers"
  },
  {
    label: "Public Ethereum wallet example",
    address: ethExampleWallet,
    chains: "base,ethereum",
    prompt: "analyze this public Ethereum wallet and summarize portfolio plus recent activity"
  },
  {
    label: "Ethereum burn address",
    address: "0x000000000000000000000000000000000000dEaD",
    chains: "ethereum,base",
    prompt: "summarize token holdings and transfers for the Ethereum burn address"
  },
  {
    label: "Ethereum zero address",
    address: "0x0000000000000000000000000000000000000000",
    chains: "ethereum,base",
    prompt: "inspect token balances and transfer history for the zero address"
  }
] as const;

const portfolioQuerySchema = z.object({
  address: z.string().regex(evmAddressPattern),
  chains: z.string().optional()
});

const txHistoryQuerySchema = z.object({
  address: z.string().regex(evmAddressPattern),
  chains: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  days: z.coerce.number().int().positive().max(365).optional(),
  category: z.enum(["all", "external", "internal", "erc20", "erc721", "erc1155"]).optional()
});

const paidQuerySchemas = {
  "/portfolio": portfolioQuerySchema,
  "/tx-history": txHistoryQuerySchema,
  "/wallet-report": txHistoryQuerySchema
} as const;

type PreviewCache = {
  expiresAt: number;
  source: "live" | "fallback";
  snapshot: PortfolioSnapshot;
};

let previewCache: PreviewCache | null = null;

export function createApp() {
  const app = express();

  app.use(express.json());
  app.use(analyticsMiddleware);
  app.use(express.static("public"));
  app.use("/docs", express.static("docs"));

  app.get("/pricing", (_req, res) => {
    res.sendFile("pricing.html", { root: "public" });
  });

  app.get("/examples", (req, res) => {
    if (wantsJson(req)) {
      res.json(buildExamples());
      return;
    }

    res.sendFile("examples.html", { root: "public" });
  });

  app.get("/discover", (_req, res) => {
    res.json(buildDiscoverPayload());
  });

  app.get("/wallets-to-try", (req, res) => {
    if (wantsJson(req)) {
      res.json(buildWalletsToTryPayload());
      return;
    }

    res.type("html").send(buildWalletsToTryHtml());
  });

  app.get(["/ask", "/analyze"], (req, res) => {
    res.json(buildIntentPayload(req));
  });

  app.get("/examples/portfolio", (_req, res) => {
    res.json(buildSamplePayload("/portfolio", portfolioExample));
  });

  app.get("/examples/tx-history", (_req, res) => {
    res.json(buildSamplePayload("/tx-history", txHistoryExample));
  });

  app.get("/examples/wallet-report", (_req, res) => {
    res.json(buildSamplePayload("/wallet-report", walletReportExample));
  });

  app.get("/walletlens-agent-skill.md", (_req, res) => {
    res.sendFile("walletlens-agent-skill.md", { root: "docs" });
  });

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "web3-x402-portfolio",
      name: "WalletLens API",
      x402DevBypass: config.x402DevBypass
    });
  });

  app.get("/status", (_req, res) => {
    res.json({
      ok: true,
      name: "WalletLens API",
      version: "1.0.0",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      baseUrl: config.publicBaseUrl,
      x402DevBypass: config.x402DevBypass,
      paidResources: getPaidResources(),
      freeResources: [
        "/",
        "/preview",
        "/pricing",
        "/examples",
        "/discover",
        "/wallets-to-try",
        "/ask",
        "/analyze",
        "/examples/portfolio",
        "/examples/tx-history",
        "/examples/wallet-report",
        "/llms.txt",
        "/llms-full.txt",
        "/openapi.json",
        "/quote",
        "/.well-known/x402",
        "/.well-known/x402.json"
      ],
      supportedChains: ["base", "ethereum", "optimism", "arbitrum", "polygon"],
      docs: {
        openapi: `${config.publicBaseUrl}/openapi.json`,
        llms: `${config.publicBaseUrl}/llms.txt`,
        llmsFull: `${config.publicBaseUrl}/llms-full.txt`,
        skill: `${config.publicBaseUrl}/docs/walletlens-agent-skill.md`,
        skillAlias: `${config.publicBaseUrl}/walletlens-agent-skill.md`,
        discover: `${config.publicBaseUrl}/discover`,
        walletsToTry: `${config.publicBaseUrl}/wallets-to-try`,
        ask: `${config.publicBaseUrl}/ask?q=analyze%20wallet%20${demoWallet}%20on%20base`,
        analyze: `${config.publicBaseUrl}/analyze?address=${demoWallet}&chains=base`,
        examples: `${config.publicBaseUrl}/examples`,
        x402: `${config.publicBaseUrl}/.well-known/x402.json`
      }
    });
  });

  app.get("/preview", async (_req, res, next) => {
    try {
      const snapshot = await getPreviewSnapshot();

      res.json({
        name: "WalletLens API live preview",
        description:
          "Free cached demo response for agents evaluating the paid WalletLens /portfolio endpoint. For arbitrary wallets, use the paid endpoint.",
        paidEndpoint: `${config.publicBaseUrl}/portfolio`,
        price: paymentRouteConfig["GET /portfolio"].accepts.price,
        network: paymentRouteConfig["GET /portfolio"].accepts.network,
        previewQuery: {
          address: config.previewWalletAddress,
          chains: config.previewWalletChains
        },
        cache: {
          source: previewCache?.source ?? "live",
          ttlSeconds: config.previewCacheTtlSeconds,
          expiresAt: new Date(previewCache?.expiresAt ?? Date.now()).toISOString()
        },
        limits: {
          tokens: 10,
          recentActivity: 5
        },
        truncated: {
          tokens: Math.max(0, snapshot.tokens.length - 10),
          recentActivity: Math.max(0, snapshot.recentActivity.length - 5)
        },
        response: {
          ...snapshot,
          tokens: [...snapshot.tokens]
            .sort((left, right) => Number(right.valueUsd ?? 0) - Number(left.valueUsd ?? 0))
            .slice(0, 10),
          recentActivity: snapshot.recentActivity.slice(0, 5)
        }
      });
    } catch (error) {
      next(error);
    }
  });

  app.get(["/.well-known/x402.json", "/.well-known/x402"], (_req, res) => {
    res.json(buildX402Discovery());
  });

  app.get("/quote", (req, res) => {
    const parsed = txHistoryQuerySchema.safeParse(req.query);
    const address = typeof req.query.address === "string" ? req.query.address : undefined;
    const chains = typeof req.query.chains === "string" ? req.query.chains : "base";

    if (address && !parsed.success) {
      res.status(400).json(buildInvalidRequestBody("/wallet-report", parsed.error));
      return;
    }

    res.json({
      ok: true,
      service: "WalletLens",
      description:
        "Free quote for agent wallet analysis. Use /wallet-report for one paid call that returns portfolio plus transaction history.",
      addressRequired: true,
      addressValid: parsed.success,
      address: parsed.success ? parsed.data.address : null,
      chains,
      recommendedEndpoint: "/wallet-report",
      price: paymentRouteConfig["GET /wallet-report"].accepts.price,
      network: paymentRouteConfig["GET /wallet-report"].accepts.network,
      asset: "USDC",
      paymentProtocol: "x402",
      paidEndpoints: getPaidResources(),
      howToCall: getHowToCallExamples(),
      requiredParams: {
        address: "EVM address, 0x plus 40 hex characters"
      },
      optionalParams: {
        chains: "Comma-separated chain slugs. Supported: base, ethereum, optimism, arbitrum, polygon.",
        limit: "Transaction row limit for /tx-history and /wallet-report, 1-100.",
        days: "Requested transaction lookback intent, 1-365.",
        category: "all, external, internal, erc20, erc721, or erc1155."
      },
      examplePaidUrl: `${config.publicBaseUrl}/wallet-report?address=${
        parsed.success ? parsed.data.address : demoWallet
      }&chains=${encodeURIComponent(chains)}&limit=20`
    });
  });

  app.use(validatePaidRouteQuery);

  const paymentMiddleware = createPaymentMiddleware();
  if (paymentMiddleware) {
    app.use(paymentMiddleware);
  }

  app.get("/portfolio", async (req, res, next) => {
    try {
      const query = portfolioQuerySchema.parse(req.query);
      const snapshot = await getPortfolioSnapshot(query.address, query.chains);
      res.json(snapshot);
    } catch (error) {
      next(error);
    }
  });

  app.get("/tx-history", async (req, res, next) => {
    try {
      const query = txHistoryQuerySchema.parse(req.query);
      const snapshot = await getTxHistorySnapshot(query.address, query);
      res.json(snapshot);
    } catch (error) {
      next(error);
    }
  });

  app.get("/wallet-report", async (req, res, next) => {
    try {
      const query = txHistoryQuerySchema.parse(req.query);
      const snapshot = await getWalletReportSnapshot(query.address, query);
      res.json(snapshot);
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request", details: error.flatten() });
      return;
    }

    if (error instanceof Error && error.name === "ValidationError") {
      res.status(400).json({ error: error.message });
      return;
    }

    if (error instanceof Error && error.name === "ConfigurationError") {
      res.status(500).json({ error: error.message });
      return;
    }

    if (error instanceof Error && error.name === "ProviderError") {
      res.status(502).json({ error: "Provider error", details: error.message });
      return;
    }

    if (error instanceof Error && error.message.startsWith("Unsupported chain:")) {
      res.status(400).json({ error: error.message });
      return;
    }

    console.error(error);
    res.status(500).json({ error: "Internal error" });
  });

  return app;
}

function wantsJson(req: express.Request) {
  return req.query.format === "json" || req.accepts(["html", "json"]) === "json";
}

function buildX402Discovery() {
  return {
    version: "1",
    service: "WalletLens",
    description:
      "Agent-native EVM wallet intelligence suite for portfolio snapshots, token balances, Base wallet lookup, USDC transfers, and enriched transaction history.",
    baseUrl: config.publicBaseUrl,
    discovery: {
      canonical: `${config.publicBaseUrl}/.well-known/x402.json`,
      alias: `${config.publicBaseUrl}/.well-known/x402`
    },
    howToCall: getHowToCallExamples(),
    resources: getPaidResources()
  };
}

function buildDiscoverPayload() {
  return {
    ok: true,
    service: "WalletLens",
    description:
      "WalletLens is an x402-paid EVM wallet intelligence API for agents. Use it for portfolio snapshots, transaction history, and bundled wallet reports.",
    baseUrl: config.publicBaseUrl,
    payment: {
      protocol: "x402",
      scheme: "exact",
      network: paymentRouteConfig["GET /wallet-report"].accepts.network,
      asset: "USDC",
      defaultPrice: paymentRouteConfig["GET /wallet-report"].accepts.price
    },
    recommendedFlow: [
      "Call /wallets-to-try for seeded wallet addresses and direct paid URLs that demonstrate valid address requests.",
      "Call /ask?q=analyze wallet 0x... on base or /analyze?address=0x...&chains=base to convert natural-language intent into a paid URL.",
      "Call /quote with address and chains to validate the request and inspect pricing.",
      "Call /wallet-report for one paid response that includes portfolio plus transaction history.",
      "If the response is HTTP 402, parse the payment-required header, create an x402 payment, and retry the same URL with the payment header."
    ],
    useCases: [
      "analyze this wallet",
      "summarize this Base wallet",
      "get token balances for an EVM address",
      "find recent USDC transfers",
      "get enriched transaction history",
      "combine wallet portfolio and recent activity"
    ],
    freeResources: {
      status: `${config.publicBaseUrl}/status`,
      walletsToTry: `${config.publicBaseUrl}/wallets-to-try`,
      walletsToTryJson: `${config.publicBaseUrl}/wallets-to-try?format=json`,
      ask: `${config.publicBaseUrl}/ask?q=analyze%20wallet%20${demoWallet}%20on%20base`,
      analyze: `${config.publicBaseUrl}/analyze?address=${demoWallet}&chains=base`,
      quote: `${config.publicBaseUrl}/quote?address=${demoWallet}&chains=base`,
      preview: `${config.publicBaseUrl}/preview`,
      examples: `${config.publicBaseUrl}/examples?format=json`,
      samplePortfolio: `${config.publicBaseUrl}/examples/portfolio`,
      sampleTxHistory: `${config.publicBaseUrl}/examples/tx-history`,
      sampleWalletReport: `${config.publicBaseUrl}/examples/wallet-report`,
      openapi: `${config.publicBaseUrl}/openapi.json`,
      llms: `${config.publicBaseUrl}/llms.txt`,
      llmsFull: `${config.publicBaseUrl}/llms-full.txt`,
      skill: `${config.publicBaseUrl}/docs/walletlens-agent-skill.md`,
      skillAlias: `${config.publicBaseUrl}/walletlens-agent-skill.md`,
      x402: `${config.publicBaseUrl}/.well-known/x402.json`,
      x402Alias: `${config.publicBaseUrl}/.well-known/x402`
    },
    paidResources: getPaidResources(),
    howToCall: getHowToCallExamples(),
    walletsToTry: buildWalletLinks(),
    supportedChains: ["base", "ethereum", "optimism", "arbitrum", "polygon"]
  };
}

function buildExamples() {
  return {
    service: "WalletLens",
    baseUrl: config.publicBaseUrl,
    description:
      "Copy-paste examples for discovering WalletLens and making x402-paid EVM wallet intelligence calls.",
    demoWallet,
    free: [
      {
        name: "Browse seeded wallets with direct paid URLs",
        method: "GET",
        url: `${config.publicBaseUrl}/wallets-to-try`,
        curl: `curl "${config.publicBaseUrl}/wallets-to-try?format=json"`
      },
      {
        name: "Convert natural-language wallet intent into a paid URL",
        method: "GET",
        url: `${config.publicBaseUrl}/ask?q=analyze%20wallet%20${demoWallet}%20on%20base`,
        curl: `curl "${config.publicBaseUrl}/ask?q=analyze%20wallet%20${demoWallet}%20on%20base"`
      },
      {
        name: "Analyze intent with structured query params",
        method: "GET",
        url: `${config.publicBaseUrl}/analyze?address=${demoWallet}&chains=base`,
        curl: `curl "${config.publicBaseUrl}/analyze?address=${demoWallet}&chains=base"`
      },
      {
        name: "Discover WalletLens capabilities",
        method: "GET",
        url: `${config.publicBaseUrl}/discover`,
        curl: `curl ${config.publicBaseUrl}/discover`
      },
      {
        name: "Get a quote before paying",
        method: "GET",
        url: `${config.publicBaseUrl}/quote?address=${demoWallet}&chains=base`,
        curl: `curl "${config.publicBaseUrl}/quote?address=${demoWallet}&chains=base"`
      },
      {
        name: "Read x402 discovery metadata",
        method: "GET",
        url: `${config.publicBaseUrl}/.well-known/x402.json`,
        curl: `curl ${config.publicBaseUrl}/.well-known/x402.json`
      },
      {
        name: "Inspect a free cached preview response",
        method: "GET",
        url: `${config.publicBaseUrl}/preview`,
        curl: `curl ${config.publicBaseUrl}/preview`
      },
      {
        name: "Inspect sample wallet report JSON without payment",
        method: "GET",
        url: `${config.publicBaseUrl}/examples/wallet-report`,
        curl: `curl ${config.publicBaseUrl}/examples/wallet-report`
      }
    ],
    paidNegotiation: getHowToCallExamples(),
    walletsToTry: buildWalletLinks(),
    localPaidTest: [
      "Add a funded Base wallet private key to .env as X402_TEST_PRIVATE_KEY.",
      `Run: npm run test:x402 -- --endpoint wallet-report --address ${demoWallet} --chains base --limit 20`
    ],
    notes: [
      "Missing or invalid address returns HTTP 400 before payment negotiation.",
      "A valid unpaid paid-endpoint request returns HTTP 402 with a payment-required header.",
      "After creating the x402 payment payload, retry the exact same URL with the payment header."
    ]
  };
}

function buildWalletsToTryPayload() {
  return {
    service: "WalletLens",
    description:
      "Seed wallet list for agents and humans. Each item includes free intent-helper URLs and a direct paid /wallet-report URL that will return HTTP 402 until paid with x402.",
    baseUrl: config.publicBaseUrl,
    price: paymentRouteConfig["GET /wallet-report"].accepts.price,
    network: paymentRouteConfig["GET /wallet-report"].accepts.network,
    asset: "USDC",
    wallets: buildWalletLinks(),
    nextSteps: [
      "Open askUrl or analyzeUrl for a free conversion/quote helper.",
      "Open paidWalletReportUrl to trigger x402 payment negotiation.",
      "After x402 payment, retry the exact paid URL to receive portfolio plus transaction history."
    ]
  };
}

function buildWalletLinks() {
  return walletsToTry.map(wallet => {
    const encodedPrompt = encodeURIComponent(`${wallet.prompt}: ${wallet.address} on ${wallet.chains}`);
    const encodedChains = encodeURIComponent(wallet.chains);
    return {
      ...wallet,
      askUrl: `${config.publicBaseUrl}/ask?q=${encodedPrompt}`,
      analyzeUrl: `${config.publicBaseUrl}/analyze?address=${wallet.address}&chains=${encodedChains}`,
      quoteUrl: `${config.publicBaseUrl}/quote?address=${wallet.address}&chains=${encodedChains}`,
      paidWalletReportUrl: `${config.publicBaseUrl}/wallet-report?address=${wallet.address}&chains=${encodedChains}&limit=20`,
      paidTxHistoryUrl: `${config.publicBaseUrl}/tx-history?address=${wallet.address}&chains=${encodedChains}&limit=20`,
      paidPortfolioUrl: `${config.publicBaseUrl}/portfolio?address=${wallet.address}&chains=${encodedChains}`
    };
  });
}

function buildWalletsToTryHtml() {
  const walletRows = buildWalletLinks()
    .map(
      wallet => `<article class="wallet">
  <h2>${escapeHtml(wallet.label)}</h2>
  <p class="addr">${wallet.address}</p>
  <p>${escapeHtml(wallet.prompt)}</p>
  <div class="links">
    <a href="${wallet.askUrl}">Ask helper</a>
    <a href="${wallet.analyzeUrl}">Analyze helper</a>
    <a href="${wallet.quoteUrl}">Quote</a>
    <a href="${wallet.paidWalletReportUrl}">Paid report</a>
  </div>
</article>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Wallets to Try - WalletLens</title>
<meta name="description" content="Seed EVM wallets with direct WalletLens ask, analyze, quote, and paid x402 wallet-report URLs." />
<style>
  :root { color-scheme: dark; --bg: #061015; --panel: #0b1a22; --border: #173544; --fg: #e7f3f7; --muted: #8aa4ad; --accent: #00d4a4; --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #061015; color: var(--fg); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; line-height: 1.55; }
  main { max-width: 980px; margin: 0 auto; padding: 32px 24px 72px; }
  nav { display: flex; justify-content: space-between; gap: 18px; margin-bottom: 48px; font-family: var(--mono); font-size: 13px; }
  a { color: var(--accent); text-decoration: none; }
  h1 { margin: 0 0 12px; font-size: 42px; line-height: 1.08; letter-spacing: 0; }
  .lead { color: var(--muted); max-width: 760px; margin: 0 0 28px; }
  .tools { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 28px; }
  .tools a, .links a { border: 1px solid var(--border); border-radius: 8px; background: var(--panel); padding: 9px 12px; font-family: var(--mono); font-size: 13px; }
  .wallets { display: grid; gap: 14px; }
  .wallet { border: 1px solid var(--border); border-radius: 8px; background: var(--panel); padding: 18px; }
  .wallet h2 { margin: 0 0 6px; font-size: 16px; font-family: var(--mono); }
  .wallet p { color: var(--muted); margin: 0 0 12px; }
  .addr { color: var(--fg) !important; font-family: var(--mono); overflow-wrap: anywhere; }
  .links { display: flex; flex-wrap: wrap; gap: 8px; }
</style>
</head>
<body>
<main>
  <nav><span>WalletLens</span><span><a href="/">Home</a> / <a href="/discover">Discover</a> / <a href="/examples">Examples</a></span></nav>
  <h1>Wallets to try.</h1>
  <p class="lead">Use these seeded addresses to make valid WalletLens requests. The helper links are free; paid report links return HTTP 402 until an x402 payment is supplied.</p>
  <div class="tools">
    <a href="/wallets-to-try?format=json">JSON</a>
    <a href="/discover">Discover</a>
    <a href="/examples?format=json">Examples JSON</a>
    <a href="/openapi.json">OpenAPI</a>
  </div>
  <div class="wallets">${walletRows}</div>
</main>
</body>
</html>`;
}

function getHowToCallExamples() {
  return [
    {
      intent: "Get one bundled wallet report with portfolio and transaction history",
      method: "GET",
      path: "/wallet-report",
      url: `${config.publicBaseUrl}/wallet-report?address=${demoWallet}&chains=base&limit=20`,
      curl: `curl -i "${config.publicBaseUrl}/wallet-report?address=${demoWallet}&chains=base&limit=20"`,
      expectedUnpaidStatus: 402
    },
    {
      intent: "Get enriched transaction history only",
      method: "GET",
      path: "/tx-history",
      url: `${config.publicBaseUrl}/tx-history?address=${demoWallet}&chains=base&limit=20`,
      curl: `curl -i "${config.publicBaseUrl}/tx-history?address=${demoWallet}&chains=base&limit=20"`,
      expectedUnpaidStatus: 402
    },
    {
      intent: "Get normalized portfolio balances only",
      method: "GET",
      path: "/portfolio",
      url: `${config.publicBaseUrl}/portfolio?address=${ethExampleWallet}&chains=base,ethereum`,
      curl: `curl -i "${config.publicBaseUrl}/portfolio?address=${ethExampleWallet}&chains=base,ethereum"`,
      expectedUnpaidStatus: 402
    }
  ];
}

function buildIntentPayload(req: express.Request) {
  const text = [
    asString(req.query.q),
    asString(req.query.prompt),
    asString(req.query.intent),
    asString(req.query.address),
    asString(req.query.chains)
  ]
    .filter(Boolean)
    .join(" ");
  const address = extractAddress(text);
  const chains = normalizeIntentChains(asString(req.query.chains) ?? extractChains(text));
  const endpoint = chooseIntentEndpoint(text);
  const validAddress = Boolean(address);

  return {
    ok: true,
    service: "WalletLens",
    description:
      "Free intent helper. Converts wallet-analysis intent into a valid WalletLens paid URL, quote URL, and x402 instructions.",
    input: {
      q: asString(req.query.q) ?? null,
      address: asString(req.query.address) ?? null,
      chains: asString(req.query.chains) ?? null
    },
    detected: {
      address: address ?? null,
      addressValid: validAddress,
      chains,
      recommendedEndpoint: endpoint
    },
    readyToPay: validAddress,
    quoteUrl: validAddress ? `${config.publicBaseUrl}/quote?address=${address}&chains=${encodeURIComponent(chains)}` : null,
    paidUrl: validAddress
      ? `${config.publicBaseUrl}${endpoint}?address=${address}&chains=${encodeURIComponent(chains)}${
          endpoint === "/portfolio" ? "" : "&limit=20"
        }`
      : null,
    price: paymentRouteConfig[`GET ${endpoint}` as keyof typeof paymentRouteConfig].accepts.price,
    network: paymentRouteConfig[`GET ${endpoint}` as keyof typeof paymentRouteConfig].accepts.network,
    asset: "USDC",
    paymentProtocol: "x402",
    nextSteps: validAddress
      ? [
          "Call quoteUrl for free validation and pricing.",
          "Call paidUrl. A valid unpaid request returns HTTP 402 with a payment-required header.",
          "Create the x402 payment payload and retry the exact same paidUrl with the payment header."
        ]
      : [
          "Provide an EVM address as address=0x... or include one in q.",
          `Try /analyze?address=${demoWallet}&chains=base`,
          `Try /ask?q=analyze%20wallet%20${demoWallet}%20on%20base`
        ],
    examples: {
      analyze: `${config.publicBaseUrl}/analyze?address=${demoWallet}&chains=base`,
      ask: `${config.publicBaseUrl}/ask?q=analyze%20wallet%20${demoWallet}%20on%20base`,
      sampleReport: `${config.publicBaseUrl}/examples/wallet-report`
    }
  };
}

function buildSamplePayload(path: "/portfolio" | "/tx-history" | "/wallet-report", sample: unknown) {
  const route = paymentRouteConfig[`GET ${path}` as keyof typeof paymentRouteConfig];
  return {
    service: "WalletLens",
    sample: true,
    endpoint: path,
    description:
      "Free static sample shaped like the paid response. Use the paid endpoint with address and chains for live wallet data.",
    paidEndpoint: `${config.publicBaseUrl}${path}`,
    price: route.accepts.price,
    network: route.accepts.network,
    asset: "USDC",
    examplePaidUrl: `${config.publicBaseUrl}${path}?address=${path === "/portfolio" ? ethExampleWallet : demoWallet}&chains=${
      path === "/portfolio" ? "base,ethereum" : "base"
    }${path === "/portfolio" ? "" : "&limit=20"}`,
    response: sample
  };
}

function extractAddress(text: string) {
  return text.match(/0x[a-fA-F0-9]{40}/)?.[0] ?? null;
}

function chooseIntentEndpoint(text: string): "/portfolio" | "/tx-history" | "/wallet-report" {
  const lower = text.toLowerCase();
  if (lower.includes("transaction") || lower.includes("tx") || lower.includes("history") || lower.includes("transfer")) {
    return "/tx-history";
  }
  if (lower.includes("portfolio") || lower.includes("balance") || lower.includes("holding") || lower.includes("token")) {
    return "/portfolio";
  }
  return "/wallet-report";
}

function extractChains(text: string) {
  const lower = text.toLowerCase();
  const chains = ["base", "ethereum", "optimism", "arbitrum", "polygon"].filter(chain => lower.includes(chain));
  if (lower.includes("eth") && !chains.includes("ethereum")) chains.push("ethereum");
  return chains.length > 0 ? chains.join(",") : undefined;
}

function normalizeIntentChains(chains?: string) {
  return chains?.trim() || "base";
}

function asString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function validatePaidRouteQuery(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.method !== "GET") {
    next();
    return;
  }

  const schema = paidQuerySchemas[req.path as keyof typeof paidQuerySchemas];
  if (!schema) {
    next();
    return;
  }

  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json(buildInvalidRequestBody(req.path, parsed.error));
    return;
  }

  next();
}

function buildInvalidRequestBody(path: string, error: z.ZodError) {
  const endpoint = path as "/portfolio" | "/tx-history" | "/wallet-report";
  return {
    error: "Invalid request",
    message: "WalletLens paid endpoints require a valid EVM address before x402 payment negotiation.",
    details: error.flatten(),
    hint: "To trigger x402 payment negotiation, retry with address=0x... and optional chains=base.",
    quote: `${config.publicBaseUrl}/quote`,
    discover: `${config.publicBaseUrl}/discover`,
    intentHelper: `${config.publicBaseUrl}/ask?q=analyze%20wallet%20${demoWallet}%20on%20base`,
    examples: `${config.publicBaseUrl}/examples?format=json`,
    sampleResponse: `${config.publicBaseUrl}/examples${endpoint}`,
    requiredParams: {
      address: "EVM address, 0x plus 40 hex characters"
    },
    example: `${config.publicBaseUrl}${path}?address=${demoWallet}&chains=base${path === "/portfolio" ? "" : "&limit=20"}`,
    nextSteps: [
      `Call /analyze?address=${demoWallet}&chains=base for a free intent response.`,
      `Call /quote?address=${demoWallet}&chains=base for price and paid URL guidance.`,
      "Call the example paid URL to receive HTTP 402 and complete x402 payment negotiation."
    ]
  };
}

function getPaidResources() {
  return Object.entries(paymentRouteConfig).map(([routeKey, route]) => {
    const [method, path] = routeKey.split(" ");
    const accepts = Array.isArray(route.accepts) ? route.accepts[0] : route.accepts;

    return {
      path,
      method,
      price: accepts.price,
      network: accepts.network,
      asset: "USDC",
      description: route.description
    };
  });
}

async function getPreviewSnapshot(): Promise<PortfolioSnapshot> {
  const now = Date.now();
  if (previewCache && previewCache.expiresAt > now) {
    return previewCache.snapshot;
  }

  let source: PreviewCache["source"] = "live";
  let snapshot: PortfolioSnapshot;

  try {
    snapshot = await getPortfolioSnapshot(config.previewWalletAddress, config.previewWalletChains);
  } catch (error) {
    console.error("Preview snapshot failed; returning static fallback", error);
    source = "fallback";
    snapshot = portfolioExample as unknown as PortfolioSnapshot;
  }

  previewCache = {
    source,
    snapshot,
    expiresAt: now + config.previewCacheTtlSeconds * 1000
  };

  return snapshot;
}
