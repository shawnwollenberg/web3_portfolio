import express from "express";
import { z } from "zod";
import { config } from "./config.js";
import { getPortfolioSnapshot, type PortfolioSnapshot } from "./portfolio.js";
import { portfolioExample } from "./schemas.js";
import { getTxHistorySnapshot } from "./tx-history.js";
import { createPaymentMiddleware, paymentRouteConfig } from "./x402.js";

const portfolioQuerySchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chains: z.string().optional()
});

const txHistoryQuerySchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chains: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  days: z.coerce.number().int().positive().max(365).optional(),
  category: z.enum(["all", "external", "internal", "erc20", "erc721", "erc1155"]).optional()
});

type PreviewCache = {
  expiresAt: number;
  source: "live" | "fallback";
  snapshot: PortfolioSnapshot;
};

let previewCache: PreviewCache | null = null;

export function createApp() {
  const app = express();

  app.use(express.json());
  app.use(express.static("public"));
  app.use("/docs", express.static("docs"));

  app.get("/pricing", (_req, res) => {
    res.sendFile("pricing.html", { root: "public" });
  });

  app.get("/examples", (_req, res) => {
    res.sendFile("examples.html", { root: "public" });
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
      freeResources: ["/", "/preview", "/pricing", "/examples", "/llms.txt", "/llms-full.txt", "/openapi.json"],
      supportedChains: ["base", "ethereum", "optimism", "arbitrum", "polygon"],
      docs: {
        openapi: `${config.publicBaseUrl}/openapi.json`,
        llms: `${config.publicBaseUrl}/llms.txt`,
        llmsFull: `${config.publicBaseUrl}/llms-full.txt`,
        skill: `${config.publicBaseUrl}/docs/walletlens-agent-skill.md`,
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

  app.get("/.well-known/x402.json", (_req, res) => {
    res.json({
      version: "1",
      service: "WalletLens",
      description: "Agent-native web3 data suite: portfolio snapshots and enriched transaction history.",
      resources: getPaidResources()
    });
  });

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

    if (error instanceof Error && error.message.startsWith("Unsupported chain:")) {
      res.status(400).json({ error: error.message });
      return;
    }

    console.error(error);
    res.status(500).json({ error: "Internal error" });
  });

  return app;
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
