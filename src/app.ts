import express from "express";
import { z } from "zod";
import { config } from "./config.js";
import { getPortfolioSnapshot } from "./portfolio.js";
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

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "web3-x402-portfolio",
      name: "WalletLens API",
      x402DevBypass: config.x402DevBypass
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
