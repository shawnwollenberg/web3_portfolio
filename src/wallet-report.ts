import { getPortfolioSnapshot, type PortfolioSnapshot } from "./portfolio.js";
import { getTxHistorySnapshot, type TxHistorySnapshot } from "./tx-history.js";

export type WalletReportSnapshot = {
  address: string;
  timestamp: string;
  chains: string[];
  request: {
    portfolioChains: string | undefined;
    txHistoryChains: string | undefined;
    limit: number;
    days: number;
    category: string;
  };
  summary: {
    totalValueUsd: string | null;
    tokenCount: number;
    stablecoinValueUsd: string | null;
    topHoldings: PortfolioSnapshot["summary"]["topHoldings"];
    transactionCount: number;
    transactionDirections: TxHistorySnapshot["summary"]["directions"];
    transactionActions: TxHistorySnapshot["summary"]["actions"];
    warnings: string[];
  };
  portfolio: PortfolioSnapshot;
  txHistory: TxHistorySnapshot;
  provider: "alchemy";
  note: string;
};

export async function getWalletReportSnapshot(
  address: string,
  options: {
    chains?: string;
    limit?: number;
    days?: number;
    category?: string;
  } = {}
): Promise<WalletReportSnapshot> {
  const [portfolio, txHistory] = await Promise.all([
    getPortfolioSnapshot(address, options.chains),
    getTxHistorySnapshot(address, options)
  ]);

  return {
    address: portfolio.address,
    timestamp: new Date().toISOString(),
    chains: [...new Set([...portfolio.chains, ...txHistory.chains])],
    request: {
      portfolioChains: options.chains,
      txHistoryChains: options.chains,
      limit: txHistory.request.limit,
      days: txHistory.request.days,
      category: txHistory.request.category
    },
    summary: {
      totalValueUsd: portfolio.summary.totalValueUsd,
      tokenCount: portfolio.summary.tokenCount,
      stablecoinValueUsd: portfolio.summary.stablecoinValueUsd,
      topHoldings: portfolio.summary.topHoldings,
      transactionCount: txHistory.summary.transactionCount,
      transactionDirections: txHistory.summary.directions,
      transactionActions: txHistory.summary.actions,
      warnings: [...portfolio.summary.warnings, ...txHistory.summary.warnings]
    },
    portfolio,
    txHistory,
    provider: "alchemy",
    note: "WalletLens report combines normalized portfolio balances with TxLens enriched transaction history for agent wallet analysis."
  };
}
