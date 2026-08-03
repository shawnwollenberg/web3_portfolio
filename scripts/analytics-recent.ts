import { execFileSync } from "node:child_process";

type AnalyticsEvent = {
  event: "walletlens.request";
  timestamp: string;
  method?: string;
  path: string;
  statusCode: number;
  latencyMs?: number;
  paidPath?: boolean;
  paid?: boolean;
  hasPaymentHeader?: boolean;
  payer?: string;
  settlementTx?: string;
  addressRequested?: string;
  chains?: string;
  userAgent?: string;
  ipHash?: string;
  response?: {
    tokenCount?: number;
    transactionCount?: number;
    totalValueBucket?: string | null;
    error?: string;
    errorReason?: string;
  };
};

type BazaarExtensionResponse = {
  timestamp: string;
  extension: string;
  status: string;
};

const args = parseArgs(process.argv.slice(2));
const hours = Number(args.hours ?? "24");
const profile = args.profile ?? process.env.AWS_PROFILE ?? "wallyweb";
const region = args.region ?? process.env.AWS_REGION ?? process.env.DEPLOY_REGION ?? "us-east-2";
const stackName = args.stack ?? "Web3PortfolioStack";
const logGroup = args.logGroup ?? findLogGroup(profile, region, stackName);
const startTime = Date.now() - Math.max(1, hours) * 60 * 60 * 1000;

const events = fetchAnalyticsEvents(profile, region, logGroup, startTime);
const bazaarExtensionResponses = fetchBazaarExtensionResponses(profile, region, logGroup, startTime);
printSummary(events, bazaarExtensionResponses, logGroup, hours);

function fetchAnalyticsEvents(profile: string, region: string, logGroup: string, startTime: number): AnalyticsEvent[] {
  const output = execFileSync(
    "aws",
    [
      "logs",
      "filter-log-events",
      "--profile",
      profile,
      "--region",
      region,
      "--log-group-name",
      logGroup,
      "--start-time",
      String(startTime),
      "--filter-pattern",
      "{ $.event = \"walletlens.request\" }",
      "--output",
      "json"
    ],
    { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 }
  );

  const parsed = JSON.parse(output) as { events?: Array<{ message?: string }> };
  return (parsed.events ?? []).flatMap(event => {
    if (!event.message) return [];
    try {
      const maybeEvent = JSON.parse(extractJson(event.message)) as AnalyticsEvent;
      return maybeEvent.event === "walletlens.request" ? [maybeEvent] : [];
    } catch {
      return [];
    }
  });
}

function fetchBazaarExtensionResponses(
  profile: string,
  region: string,
  logGroup: string,
  startTime: number
): BazaarExtensionResponse[] {
  const output = execFileSync(
    "aws",
    [
      "logs",
      "filter-log-events",
      "--profile",
      profile,
      "--region",
      region,
      "--log-group-name",
      logGroup,
      "--start-time",
      String(startTime),
      "--filter-pattern",
      '"[x402] extension responses:"',
      "--output",
      "json"
    ],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
  );

  const parsed = JSON.parse(output) as { events?: Array<{ message?: string; timestamp?: number }> };
  return (parsed.events ?? []).flatMap(event => {
    const marker = "[x402] extension responses: ";
    const markerIndex = event.message?.indexOf(marker) ?? -1;
    if (!event.message || markerIndex === -1) return [];

    try {
      const body = JSON.parse(event.message.slice(markerIndex + marker.length)) as Record<
        string,
        { status?: unknown }
      >;
      return Object.entries(body).flatMap(([extension, result]) =>
        typeof result?.status === "string"
          ? [
              {
                timestamp: new Date(event.timestamp ?? Date.now()).toISOString(),
                extension,
                status: result.status
              }
            ]
          : []
      );
    } catch {
      return [];
    }
  });
}

function extractJson(message: string): string {
  const firstBrace = message.indexOf("{");
  if (firstBrace === -1) return message;
  return message.slice(firstBrace);
}

function findLogGroup(profile: string, region: string, stackName: string): string {
  const stackOutput = execFileSync(
    "aws",
    [
      "cloudformation",
      "list-stack-resources",
      "--profile",
      profile,
      "--region",
      region,
      "--stack-name",
      stackName,
      "--output",
      "json"
    ],
    { encoding: "utf8" }
  );

  const stack = JSON.parse(stackOutput) as {
    StackResourceSummaries?: Array<{
      LogicalResourceId?: string;
      PhysicalResourceId?: string;
      ResourceType?: string;
    }>;
  };
  const managedLogGroup = stack.StackResourceSummaries?.find(
    resource =>
      resource.ResourceType === "AWS::Logs::LogGroup" &&
      resource.LogicalResourceId?.startsWith("PortfolioApiLogGroup") &&
      resource.PhysicalResourceId
  );
  if (managedLogGroup?.PhysicalResourceId) return managedLogGroup.PhysicalResourceId;

  // Backward-compatible fallback for stacks deployed before the retained log
  // group became an explicit CloudFormation resource.
  const output = execFileSync(
    "aws",
    [
      "logs",
      "describe-log-groups",
      "--profile",
      profile,
      "--region",
      region,
      "--log-group-name-prefix",
      `/aws/lambda/${stackName}-PortfolioApiFunction`,
      "--output",
      "json"
    ],
    { encoding: "utf8" }
  );

  const parsed = JSON.parse(output) as { logGroups?: Array<{ logGroupName?: string }> };
  const match = parsed.logGroups?.find(group => group.logGroupName);
  if (!match?.logGroupName) {
    throw new Error(`No Lambda log group found for stack ${stackName} in ${region}`);
  }
  return match.logGroupName;
}

function printSummary(
  events: AnalyticsEvent[],
  bazaarExtensionResponses: BazaarExtensionResponse[],
  logGroup: string,
  hours: number
) {
  const paidEvents = events.filter(event => event.paid);
  const paidPathEvents = events.filter(event => isPaidPath(event.path));
  const validChallenges = paidPathEvents.filter(event => event.statusCode === 402 && event.addressRequested);
  const paymentHeaderAttempts = paidPathEvents.filter(event => event.hasPaymentHeader);
  const statuses = countBy(events, event => String(event.statusCode));

  console.log(`WalletLens analytics, last ${hours}h`);
  console.log(`logGroup: ${logGroup}`);
  console.log(`requests: ${events.length}`);
  console.log(`paid: ${paidEvents.length}`);
  console.log(`status: ${formatCounts(statuses)}`);
  console.log("");

  console.log("Agent conversion funnel");
  console.log(`  paid-path requests: ${paidPathEvents.length}`);
  console.log(`  requests with wallet address: ${paidPathEvents.filter(event => event.addressRequested).length}`);
  console.log(`  valid 402 challenges: ${validChallenges.length}`);
  console.log(`  requests carrying payment headers: ${paymentHeaderAttempts.length}`);
  console.log(`  confirmed paid requests: ${paidEvents.length}`);
  console.log(`  distinct payers: ${uniqueCount(paidEvents, event => event.payer)}`);
  const distinctClients = uniqueCount(events, event => event.ipHash);
  const distinctChallengeClients = uniqueCount(validChallenges, event => event.ipHash);
  if (distinctClients > 0) console.log(`  distinct hashed clients: ${distinctClients}`);
  if (distinctChallengeClients > 0) console.log(`  distinct hashed clients reaching 402: ${distinctChallengeClients}`);
  console.log("");

  printCounts("Methods", countBy(events, event => event.method ?? "(none)"));
  printCounts("Method + status", countBy(events, event => `${event.method ?? "(none)"} ${event.statusCode}`));
  printCounts("Endpoints", countBy(events, event => event.path));
  printCounts("Paid endpoints", countBy(paidEvents, event => event.path));
  printCounts("Requested wallets", countBy(events, event => event.addressRequested ?? "(none)"), 12);
  printCounts("Payers", countBy(paidEvents, event => event.payer ?? "(unknown)"), 12);
  printCounts("Chains", countBy(events, event => event.chains ?? "(none)"), 12);
  printCounts("Value buckets", countBy(events, event => event.response?.totalValueBucket ?? "(none)"), 12);
  printCounts("User agents", countBy(events, event => normalizeUserAgent(event.userAgent)), 12);
  printCounts("404 paths", countBy(events.filter(event => event.statusCode === 404), event => event.path), 12);
  printCounts("400 errors", countBy(events.filter(event => event.statusCode === 400), errorKey), 12);
  printCounts("500 errors", countBy(events.filter(event => event.statusCode >= 500), errorKey), 12);
  printCounts("402 address presence", countBy(events.filter(event => event.statusCode === 402), addressPresence), 4);
  printCounts("Paid path address presence", countBy(events.filter(event => isPaidPath(event.path)), addressPresence), 4);
  printCounts(
    "Paid path method probes",
    countBy(paidPathEvents.filter(event => event.method && event.method !== "GET"), event => `${event.method} ${event.path}`),
    12
  );
  printCounts(
    "Bazaar facilitator extension responses",
    countBy(bazaarExtensionResponses, event => `${event.extension}:${event.status}`),
    12
  );

  const latencies = events.map(event => event.latencyMs).filter((value): value is number => typeof value === "number");
  if (latencies.length > 0) {
    latencies.sort((left, right) => left - right);
    console.log("");
    console.log(`latency p50: ${percentile(latencies, 0.5)}ms`);
    console.log(`latency p95: ${percentile(latencies, 0.95)}ms`);
  }
}

function uniqueCount<T>(items: T[], getValue: (item: T) => string | undefined): number {
  return new Set(items.map(getValue).filter((value): value is string => Boolean(value))).size;
}

function isPaidPath(path: string): boolean {
  return path === "/portfolio" || path === "/tx-history" || path === "/wallet-report";
}

function addressPresence(event: AnalyticsEvent): string {
  return event.addressRequested ? "with_address" : "without_address";
}

function errorKey(event: AnalyticsEvent): string {
  const reason = event.response?.errorReason ? `: ${event.response.errorReason}` : "";
  return `${event.path} ${event.response?.error ?? `HTTP ${event.statusCode}`}${reason}`;
}

function normalizeUserAgent(value: string | undefined): string {
  if (!value) return "(none)";
  return value.length > 80 ? `${value.slice(0, 79)}...` : value;
}

function printCounts(title: string, counts: Map<string, number>, limit = 10) {
  console.log(title);
  for (const [key, count] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)) {
    console.log(`  ${key}: ${count}`);
  }
  if (counts.size === 0) console.log("  none");
  console.log("");
}

function countBy<T>(items: T[], getKey: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = getKey(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function formatCounts(counts: Map<string, number>): string {
  return [...counts.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([key, count]) => `${key}=${count}`)
    .join(", ");
}

function percentile(values: number[], p: number): number {
  return values[Math.min(values.length - 1, Math.floor(values.length * p))] ?? 0;
}

function parseArgs(args: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const value = inlineValue ?? args[index + 1];
    if (inlineValue === undefined) index += 1;
    parsed[rawKey] = value;
  }

  return parsed;
}
