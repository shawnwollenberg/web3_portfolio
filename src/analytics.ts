import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";

type ResponseStats = {
  tokenCount?: number;
  transactionCount?: number;
  totalValueBucket?: string | null;
  chains?: string[];
};

type SettlementResponse = {
  success?: boolean;
  payer?: string;
  transaction?: string;
  network?: string;
  errorReason?: string;
  errorMessage?: string;
};

const paidPaths = new Set(["/portfolio", "/tx-history", "/wallet-report"]);

export function analyticsMiddleware(req: Request, res: Response, next: NextFunction) {
  const startedAt = Date.now();
  let responseStats: ResponseStats | undefined;

  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    responseStats = summarizeResponse(req.path, body);
    return originalJson(body);
  }) as Response["json"];

  res.on("finish", () => {
    const settlement = parseSettlementHeader(res);
    const query = normalizeQuery(req.query);
    const isPaidPath = paidPaths.has(req.path);

    console.log(
      JSON.stringify({
        event: "walletlens.request",
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        latencyMs: Date.now() - startedAt,
        paidPath: isPaidPath,
        paid: Boolean(settlement?.success),
        payer: settlement?.payer,
        settlementTx: settlement?.transaction,
        paymentNetwork: settlement?.network,
        settlementError: settlement?.errorReason ?? settlement?.errorMessage,
        hasPaymentHeader: Boolean(req.get("payment-signature") || req.get("x-payment")),
        addressRequested: stringOrUndefined(query.address),
        chains: stringOrUndefined(query.chains),
        limit: stringOrUndefined(query.limit),
        days: stringOrUndefined(query.days),
        category: stringOrUndefined(query.category),
        userAgent: truncate(req.get("user-agent"), 240),
        referer: truncate(req.get("referer"), 240),
        ipHash: hashIp(getClientIp(req)),
        response: responseStats
      })
    );
  });

  next();
}

function summarizeResponse(path: string, body: unknown): ResponseStats | undefined {
  if (!body || typeof body !== "object") return undefined;
  const data = body as Record<string, unknown>;

  if (path === "/portfolio") {
    const summary = objectOrUndefined(data.summary);
    return {
      tokenCount: numberOrUndefined(summary?.tokenCount),
      totalValueBucket: bucketUsd(stringOrUndefined(summary?.totalValueUsd)),
      chains: stringArrayOrUndefined(data.chains)
    };
  }

  if (path === "/tx-history") {
    const summary = objectOrUndefined(data.summary);
    return {
      transactionCount: numberOrUndefined(summary?.transactionCount),
      chains: stringArrayOrUndefined(data.chains)
    };
  }

  if (path === "/wallet-report") {
    const summary = objectOrUndefined(data.summary);
    return {
      tokenCount: numberOrUndefined(summary?.tokenCount),
      transactionCount: numberOrUndefined(summary?.transactionCount),
      totalValueBucket: bucketUsd(stringOrUndefined(summary?.totalValueUsd)),
      chains: stringArrayOrUndefined(data.chains)
    };
  }

  return undefined;
}

function parseSettlementHeader(res: Response): SettlementResponse | undefined {
  const value = headerValue(res.getHeader("payment-response")) ?? headerValue(res.getHeader("x-payment-response"));
  if (!value) return undefined;

  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as SettlementResponse;
  } catch {
    try {
      return JSON.parse(Buffer.from(value, "base64").toString("utf8")) as SettlementResponse;
    } catch {
      return undefined;
    }
  }
}

function getClientIp(req: Request): string | undefined {
  const forwardedFor = req.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || req.ip || req.socket.remoteAddress || undefined;
}

function hashIp(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  return crypto
    .createHash("sha256")
    .update(`${config.analyticsIpSalt}:${ip}`)
    .digest("hex")
    .slice(0, 24);
}

function normalizeQuery(query: Request["query"]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(query).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
}

function headerValue(value: number | string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0];
  if (typeof value === "number") return String(value);
  return undefined;
}

function objectOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function stringArrayOrUndefined(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(item => typeof item === "string") as string[];
}

function bucketUsd(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  if (amount === 0) return "0";
  if (amount < 1) return "<1";
  if (amount < 10) return "1-10";
  if (amount < 100) return "10-100";
  if (amount < 1000) return "100-1k";
  if (amount < 10000) return "1k-10k";
  if (amount < 100000) return "10k-100k";
  return "100k+";
}

function truncate(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}
