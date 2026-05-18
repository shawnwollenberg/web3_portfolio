import {
  AssetTransfersCategory,
  SortingOrder,
  type AssetTransfersWithMetadataResult
} from "alchemy-sdk";
import { z } from "zod";
import { config } from "./config.js";
import { parseChains, type SupportedChain } from "./chains.js";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

const categoryMap = {
  all: [
    AssetTransfersCategory.EXTERNAL,
    AssetTransfersCategory.INTERNAL,
    AssetTransfersCategory.ERC20,
    AssetTransfersCategory.ERC721,
    AssetTransfersCategory.ERC1155
  ],
  external: [AssetTransfersCategory.EXTERNAL],
  internal: [AssetTransfersCategory.INTERNAL],
  erc20: [AssetTransfersCategory.ERC20],
  erc721: [AssetTransfersCategory.ERC721],
  erc1155: [AssetTransfersCategory.ERC1155]
} as const;

export type TxHistoryCategory = keyof typeof categoryMap;

export type TxHistorySnapshot = {
  address: string;
  timestamp: string;
  chains: string[];
  request: {
    limit: number;
    days: number;
    category: TxHistoryCategory;
  };
  summary: TxHistorySummary;
  transactions: EnrichedTransaction[];
  pagination: {
    pageKeys: ChainPageKey[];
  };
  provider: "alchemy";
  note: string;
};

export type TxHistorySummary = {
  transactionCount: number;
  chains: Array<{
    chain: string;
    transactionCount: number;
  }>;
  directions: {
    in: number;
    out: number;
    self: number;
    unknown: number;
  };
  actions: Record<string, number>;
  assets: Array<{
    asset: string;
    count: number;
  }>;
  warnings: string[];
};

export type EnrichedTransaction = {
  chain: string;
  chainId: string;
  hash: string;
  uniqueId: string;
  timestamp: string | null;
  blockNumber: string;
  from: string | null;
  to: string | null;
  counterparty: string | null;
  direction: "in" | "out" | "self" | "unknown";
  category: string;
  type: string;
  protocol: string | null;
  asset: string | null;
  value: string | null;
  tokenId: string | null;
  contract: string | null;
  valueUsd: string | null;
  decoded: {
    summary: string;
    event: string | null;
  };
  labels: string[];
  riskFlags: string[];
};

type ChainPageKey = {
  chain: string;
  direction: "in" | "out";
  pageKey: string;
};

type ChainTransferResult = {
  chain: SupportedChain;
  direction: "in" | "out";
  transfers: AssetTransfersWithMetadataResult[];
  pageKey?: string;
};

type AssetTransfersRpcResponse = {
  result?: {
    transfers?: AssetTransfersWithMetadataResult[];
    pageKey?: string;
  };
  error?: {
    code?: number;
    message?: string;
  };
};

export async function getTxHistorySnapshot(
  address: string,
  options: {
    chains?: string;
    limit?: number;
    days?: number;
    category?: string;
  } = {}
): Promise<TxHistorySnapshot> {
  const parsedAddress = addressSchema.safeParse(address);
  if (!parsedAddress.success) {
    const error = new Error("Invalid EVM address");
    error.name = "ValidationError";
    throw error;
  }

  if (!config.alchemyApiKey) {
    const error = new Error("ALCHEMY_API_KEY is required");
    error.name = "ConfigurationError";
    throw error;
  }

  const chains = parseChains(options.chains);
  const category = parseCategory(options.category);
  const limit = clampInteger(options.limit ?? 50, 1, 100);
  const days = clampInteger(options.days ?? 30, 1, 365);
  const perDirectionLimit = Math.min(100, Math.max(1, Math.ceil(limit / chains.length)));

  const chainResults = await Promise.all(
    chains.flatMap(chain => [
      getTransfersForChain(chain, parsedAddress.data, "out", category, perDirectionLimit),
      getTransfersForChain(chain, parsedAddress.data, "in", category, perDirectionLimit)
    ])
  );

  const transactions = dedupeTransfers(chainResults)
    .map(({ chain, transfer }) => enrichTransaction(parsedAddress.data, chain, transfer))
    .sort(compareTransactionsNewestFirst)
    .slice(0, limit);

  return {
    address: parsedAddress.data,
    timestamp: new Date().toISOString(),
    chains: chains.map(chain => chain.slug),
    request: {
      limit,
      days,
      category
    },
    summary: buildSummary(transactions, chains, days),
    transactions,
    pagination: {
      pageKeys: chainResults.flatMap(result =>
        result.pageKey
          ? [
              {
                chain: result.chain.slug,
                direction: result.direction,
                pageKey: result.pageKey
              }
            ]
          : []
      )
    },
    provider: "alchemy",
    note: "Enriched and normalized by WalletLens TxLens. Date range is reported as intent; current Alchemy transfer fetch uses newest available transfers per chain."
  };
}

async function getTransfersForChain(
  chain: SupportedChain,
  address: string,
  direction: "in" | "out",
  category: TxHistoryCategory,
  maxCount: number
): Promise<ChainTransferResult> {
  const response = await getAssetTransfers(chain, {
    ...(direction === "out" ? { fromAddress: address } : { toAddress: address }),
    category: [...categoryMap[category]],
    excludeZeroValue: true,
    maxCount: `0x${maxCount.toString(16)}`,
    order: SortingOrder.DESCENDING,
    withMetadata: true
  });

  return {
    chain,
    direction,
    transfers: response.transfers ?? [],
    pageKey: response.pageKey
  };
}

async function getAssetTransfers(chain: SupportedChain, params: Record<string, unknown>) {
  const response = await fetch(`https://${chain.alchemyNetwork}.g.alchemy.com/v2/${config.alchemyApiKey}`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "alchemy_getAssetTransfers",
      params: [params]
    })
  });

  const responseText = await response.text();
  const body = parseAssetTransfersResponse(responseText);

  if (!response.ok || body.error) {
    const error = new Error(
      body.error?.message ?? (responseText || `Alchemy transfer request failed with HTTP ${response.status}`)
    );
    error.name = "ProviderError";
    throw error;
  }

  return {
    transfers: body.result?.transfers ?? [],
    pageKey: body.result?.pageKey
  };
}

function parseAssetTransfersResponse(text: string): AssetTransfersRpcResponse {
  if (!text) return {};

  try {
    return JSON.parse(text) as AssetTransfersRpcResponse;
  } catch {
    return {
      error: {
        message: text
      }
    };
  }
}

function dedupeTransfers(results: ChainTransferResult[]) {
  const transfers = new Map<string, { chain: SupportedChain; transfer: AssetTransfersWithMetadataResult }>();

  for (const result of results) {
    for (const transfer of result.transfers) {
      transfers.set(`${result.chain.slug}:${transfer.uniqueId}`, {
        chain: result.chain,
        transfer
      });
    }
  }

  return [...transfers.values()];
}

function enrichTransaction(
  address: string,
  chain: SupportedChain,
  tx: AssetTransfersWithMetadataResult
): EnrichedTransaction {
  const direction = getDirection(address, tx.from, tx.to);
  const action = categorizeTransaction(tx);
  const counterparty = getCounterparty(direction, tx.from, tx.to);
  const labels = buildLabels(tx, action.type);

  return {
    chain: chain.slug,
    chainId: chain.caip2,
    hash: tx.hash,
    uniqueId: tx.uniqueId,
    timestamp: tx.metadata?.blockTimestamp ?? null,
    blockNumber: tx.blockNum,
    from: tx.from ?? null,
    to: tx.to ?? null,
    counterparty,
    direction,
    category: tx.category,
    type: action.type,
    protocol: action.protocol,
    asset: tx.asset,
    value: tx.value === null || tx.value === undefined ? null : String(tx.value),
    tokenId: tx.tokenId ?? tx.erc721TokenId ?? null,
    contract: tx.rawContract?.address ?? null,
    valueUsd: null,
    decoded: decodeEventDetails(tx, action.type),
    labels,
    riskFlags: buildRiskFlags(tx)
  };
}

export function categorizeTransaction(tx: Pick<AssetTransfersWithMetadataResult, "category" | "asset" | "value">) {
  if (tx.category === AssetTransfersCategory.ERC721 || tx.category === AssetTransfersCategory.ERC1155) {
    return { type: "nft_transfer", protocol: "NFT" };
  }

  if (tx.category === AssetTransfersCategory.ERC20) {
    return { type: "token_transfer", protocol: "Token" };
  }

  if (tx.category === AssetTransfersCategory.INTERNAL) {
    return { type: "contract_transfer", protocol: "Contract" };
  }

  if (tx.asset === "ETH") {
    return { type: "native_transfer", protocol: "Native" };
  }

  return { type: "transfer", protocol: null };
}

function decodeEventDetails(tx: AssetTransfersWithMetadataResult, type: string) {
  const asset = tx.asset ?? "unknown asset";
  const value = tx.value === null || tx.value === undefined ? "unknown amount" : String(tx.value);

  return {
    summary: `${type} of ${value} ${asset}`,
    event: inferEventName(tx.category)
  };
}

function inferEventName(category: string): string | null {
  if (category === AssetTransfersCategory.ERC20) return "Transfer(address,address,uint256)";
  if (category === AssetTransfersCategory.ERC721) return "Transfer(address,address,uint256)";
  if (category === AssetTransfersCategory.ERC1155) return "TransferSingle/TransferBatch";
  return null;
}

function getDirection(address: string, from: string | null, to: string | null): EnrichedTransaction["direction"] {
  const normalized = address.toLowerCase();
  const fromMatches = from?.toLowerCase() === normalized;
  const toMatches = to?.toLowerCase() === normalized;

  if (fromMatches && toMatches) return "self";
  if (fromMatches) return "out";
  if (toMatches) return "in";
  return "unknown";
}

function getCounterparty(direction: EnrichedTransaction["direction"], from: string | null, to: string | null) {
  if (direction === "in") return from;
  if (direction === "out") return to;
  return null;
}

function buildLabels(tx: AssetTransfersWithMetadataResult, type: string): string[] {
  const labels = [type, tx.category];
  if (tx.asset) labels.push(tx.asset);
  return [...new Set(labels)];
}

function buildRiskFlags(tx: AssetTransfersWithMetadataResult): string[] {
  const flags: string[] = [];
  if (!tx.to) flags.push("missing_to_address");
  if (!tx.asset) flags.push("missing_asset_symbol");
  if (tx.value === null) flags.push("missing_decimal_value");
  return flags;
}

function buildSummary(transactions: EnrichedTransaction[], chains: SupportedChain[], days: number): TxHistorySummary {
  const directionCounts = {
    in: 0,
    out: 0,
    self: 0,
    unknown: 0
  };
  const actionCounts = new Map<string, number>();
  const assetCounts = new Map<string, number>();
  const chainCounts = new Map<string, number>();

  for (const transaction of transactions) {
    directionCounts[transaction.direction] += 1;
    actionCounts.set(transaction.type, (actionCounts.get(transaction.type) ?? 0) + 1);
    assetCounts.set(transaction.asset ?? "unknown", (assetCounts.get(transaction.asset ?? "unknown") ?? 0) + 1);
    chainCounts.set(transaction.chain, (chainCounts.get(transaction.chain) ?? 0) + 1);
  }

  const warnings = [
    "USD values are currently null for transaction history.",
    `days=${days} is accepted for agent intent but not yet converted to block ranges.`
  ];

  return {
    transactionCount: transactions.length,
    chains: chains.map(chain => ({
      chain: chain.slug,
      transactionCount: chainCounts.get(chain.slug) ?? 0
    })),
    directions: directionCounts,
    actions: Object.fromEntries(actionCounts),
    assets: [...assetCounts.entries()]
      .map(([asset, count]) => ({ asset, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 10),
    warnings
  };
}

function compareTransactionsNewestFirst(left: EnrichedTransaction, right: EnrichedTransaction) {
  const leftTime = left.timestamp ? Date.parse(left.timestamp) : 0;
  const rightTime = right.timestamp ? Date.parse(right.timestamp) : 0;
  return rightTime - leftTime || Number(BigInt(right.blockNumber)) - Number(BigInt(left.blockNumber));
}

function parseCategory(input: string | undefined): TxHistoryCategory {
  const normalized = (input ?? "all").toLowerCase();
  if (normalized in categoryMap) return normalized as TxHistoryCategory;

  const error = new Error(`Unsupported transaction category: ${input}`);
  error.name = "ValidationError";
  throw error;
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
