import express from "express";
import { z } from "zod";
import { config } from "./config.js";
import { getPortfolioSnapshot } from "./portfolio.js";
import { portfolioExample } from "./schemas.js";
import { createPaymentMiddleware, paymentRouteConfig } from "./x402.js";

const portfolioQuerySchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chains: z.string().optional()
});

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
    const route = paymentRouteConfig["GET /portfolio"];
    const accepts = Array.isArray(route.accepts) ? route.accepts[0] : route.accepts;

    res.json({
      ok: true,
      name: "WalletLens API",
      version: "1.0.0",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      baseUrl: config.publicBaseUrl,
      x402DevBypass: config.x402DevBypass,
      paidResources: [
        {
          path: "/portfolio",
          method: "GET",
          price: accepts.price,
          network: accepts.network,
          asset: "USDC",
          description: route.description
        }
      ],
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

  app.get("/preview", (_req, res) => {
    res.json({
      name: "WalletLens API preview",
      description: "Free sample response for agents evaluating the paid WalletLens /portfolio endpoint.",
      paidEndpoint: `${config.publicBaseUrl}/portfolio`,
      price: paymentRouteConfig["GET /portfolio"].accepts.price,
      network: paymentRouteConfig["GET /portfolio"].accepts.network,
      exampleQuery: {
        address: portfolioExample.address,
        chains: portfolioExample.chains.join(",")
      },
      exampleResponse: portfolioExample
    });
  });

  app.get("/.well-known/x402.json", (_req, res) => {
    const route = paymentRouteConfig["GET /portfolio"];
    const accepts = Array.isArray(route.accepts) ? route.accepts[0] : route.accepts;

    res.json({
      version: "1",
      resources: [
        {
          path: "/portfolio",
          method: "GET",
          price: accepts.price,
          network: accepts.network,
          description: route.description
        }
      ]
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
