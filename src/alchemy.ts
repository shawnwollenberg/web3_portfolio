import { config } from "./config.js";

const ALCHEMY_DATA_API_BASE_URL = "https://api.g.alchemy.com/data/v1";

export const AssetTransfersCategory = {
  EXTERNAL: "external",
  INTERNAL: "internal",
  ERC20: "erc20",
  ERC721: "erc721",
  ERC1155: "erc1155"
} as const;

export const SortingOrder = {
  ASCENDING: "asc",
  DESCENDING: "desc"
} as const;

export type TokenPrice = {
  currency: string;
  value: string;
  lastUpdatedAt?: string;
};

export type AssetTransfersWithMetadataResult = {
  uniqueId: string;
  category: string;
  blockNum: string;
  from: string;
  to: string | null;
  value: number | null;
  erc721TokenId: string | null;
  erc1155Metadata: unknown[] | null;
  tokenId: string | null;
  asset: string | null;
  hash: string;
  rawContract: {
    address?: string | null;
    value?: string | null;
    decimal?: string | null;
  };
  metadata?: {
    blockTimestamp?: string | null;
  };
};

export type AlchemyPortfolioAddress = {
  address: string;
  networks: string[];
};

export type AlchemyPortfolioTokensResponse = {
  data: {
    tokens: unknown[];
    pageKey?: string;
  };
};

export type AlchemyPortfolioTransactionsResponse = {
  transactions: unknown[];
  before?: string;
  after?: string;
  totalCount?: number;
};

export function getAlchemyPortfolioTokens(addresses: AlchemyPortfolioAddress[]) {
  return postAlchemyData<AlchemyPortfolioTokensResponse>(
    "assets/tokens/by-address",
    {
      addresses,
      withMetadata: true,
      withPrices: true,
      includeNativeTokens: true
    },
    "Alchemy portfolio token request"
  );
}

export function getAlchemyPortfolioTransactions(addresses: AlchemyPortfolioAddress[], limit: number) {
  return postAlchemyData<AlchemyPortfolioTransactionsResponse>(
    "transactions/history/by-address",
    {
      addresses,
      limit
    },
    "Alchemy recent activity request"
  );
}

async function postAlchemyData<T>(path: string, body: unknown, label: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${ALCHEMY_DATA_API_BASE_URL}/${config.alchemyApiKey}/${path}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.providerTimeoutMs)
    });
  } catch (cause) {
    throw providerError(`${label} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  }

  const responseText = await response.text();
  if (!response.ok) {
    throw providerError(`${label} failed: ${extractAlchemyError(responseText, response.status)}`);
  }

  try {
    return JSON.parse(responseText) as T;
  } catch {
    throw providerError(`${label} failed: Alchemy returned invalid JSON`);
  }
}

function extractAlchemyError(responseText: string, status: number): string {
  try {
    const body = JSON.parse(responseText) as { error?: { message?: unknown }; message?: unknown };
    if (typeof body.error?.message === "string") return body.error.message;
    if (typeof body.message === "string") return body.message;
  } catch {
    // Fall back to the response text below.
  }

  return responseText || `HTTP ${status}`;
}

function providerError(message: string) {
  const error = new Error(message);
  error.name = "ProviderError";
  return error;
}
