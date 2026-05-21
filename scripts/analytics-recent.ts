import { execFileSync } from "node:child_process";

type AnalyticsEvent = {
  event: "walletlens.request";
  timestamp: string;
  path: string;
  statusCode: number;
  latencyMs?: number;
  paid?: boolean;
  payer?: string;
  settlementTx?: string;
  addressRequested?: string;
  chains?: string;
  userAgent?: string;
  response?: {
    tokenCount?: number;
    transactionCount?: number;
    totalValueBucket?: string | null;
    error?: string;
    errorReason?: string;
  };
};

const args = parseArgs(process.argv.slice(2));
const hours = Number(args.hours ?? "24");
const profile = args.profile ?? process.env.AWS_PROFILE ?? "wallyweb";
const region = args.region ?? process.env.AWS_REGION ?? process.env.DEPLOY_REGION ?? "us-east-2";
const stackName = args.stack ?? "Web3PortfolioStack";
const logGroup = args.logGroup ?? findLogGroup(profile, region, stackName);
const startTime = Date.now() - Math.max(1, hours) * 60 * 60 * 1000;

const events = fetchAnalyticsEvents(profile, region, logGroup, startTime);
printSummary(events, logGroup, hours);

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

function extractJson(message: string): string {
  const firstBrace = message.indexOf("{");
  if (firstBrace === -1) return message;
  return message.slice(firstBrace);
}

function findLogGroup(profile: string, region: string, stackName: string): string {
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

function printSummary(events: AnalyticsEvent[], logGroup: string, hours: number) {
  const paidEvents = events.filter(event => event.paid);
  const statuses = countBy(events, event => String(event.statusCode));

  console.log(`WalletLens analytics, last ${hours}h`);
  console.log(`logGroup: ${logGroup}`);
  console.log(`requests: ${events.length}`);
  console.log(`paid: ${paidEvents.length}`);
  console.log(`status: ${formatCounts(statuses)}`);
  console.log("");

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

  const latencies = events.map(event => event.latencyMs).filter((value): value is number => typeof value === "number");
  if (latencies.length > 0) {
    latencies.sort((left, right) => left - right);
    console.log("");
    console.log(`latency p50: ${percentile(latencies, 0.5)}ms`);
    console.log(`latency p95: ${percentile(latencies, 0.95)}ms`);
  }
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
