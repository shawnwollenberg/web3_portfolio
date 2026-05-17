import * as cdk from "aws-cdk-lib";
import { Duration } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import { Construct } from "constructs";

export class Web3PortfolioStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const alchemyApiKey = process.env.ALCHEMY_API_KEY;
    const payTo = process.env.MY_WALLET_ADDRESS;
    const cdpApiKeyId = process.env.CDP_API_KEY_ID;
    const cdpApiKeySecret = process.env.CDP_API_KEY_SECRET;
    const rootDomain = process.env.ROOT_DOMAIN || "wallyweb.com";
    const customDomain = process.env.CUSTOM_DOMAIN || `walletlens.${rootDomain}`;

    if (!alchemyApiKey) {
      throw new Error("ALCHEMY_API_KEY must be set in .env before deploying");
    }

    if (!payTo) {
      throw new Error("MY_WALLET_ADDRESS must be set in .env before deploying");
    }

    const api = new NodejsFunction(this, "PortfolioApiFunction", {
      entry: "src/lambda.ts",
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      memorySize: 512,
      bundling: {
        format: cdk.aws_lambda_nodejs.OutputFormat.CJS,
        target: "node20",
        mainFields: ["module", "main"],
        sourceMap: true,
        commandHooks: {
          beforeBundling: () => [],
          beforeInstall: () => [],
          afterBundling: (_inputDir, outputDir) => [
            `cp -R public ${outputDir}/public`,
            `cp -R docs ${outputDir}/docs`
          ]
        }
      },
      environment: {
        ALCHEMY_API_KEY: alchemyApiKey,
        MY_WALLET_ADDRESS: payTo,
        X402_DEV_BYPASS: process.env.X402_DEV_BYPASS || "false",
        X402_PRICE_USD: process.env.X402_PRICE_USD || "0.02",
        X402_NETWORK: process.env.X402_NETWORK || "eip155:8453",
        X402_FACILITATOR_URL:
          process.env.X402_FACILITATOR_URL || "https://api.cdp.coinbase.com/platform/v2/x402",
        PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || `https://${customDomain}`,
        ...(cdpApiKeyId ? { CDP_API_KEY_ID: cdpApiKeyId } : {}),
        ...(cdpApiKeySecret ? { CDP_API_KEY_SECRET: cdpApiKeySecret } : {})
      }
    });

    const functionUrl = api.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE
    });

    const hostedZone = route53.HostedZone.fromLookup(this, "HostedZone", {
      domainName: rootDomain
    });

    const certificate = new acm.DnsValidatedCertificate(this, "WalletLensCertificate", {
      domainName: customDomain,
      hostedZone,
      region: "us-east-1"
    });

    const distribution = new cloudfront.Distribution(this, "WalletLensDistribution", {
      domainNames: [customDomain],
      certificate,
      defaultBehavior: {
        origin: new origins.FunctionUrlOrigin(functionUrl),
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS
      }
    });

    new route53.ARecord(this, "WalletLensAliasRecord", {
      zone: hostedZone,
      recordName: customDomain,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution))
    });

    new route53.AaaaRecord(this, "WalletLensAliasIpv6Record", {
      zone: hostedZone,
      recordName: customDomain,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution))
    });

    new cdk.CfnOutput(this, "PortfolioApiUrl", {
      value: functionUrl.url
    });

    new cdk.CfnOutput(this, "WalletLensUrl", {
      value: `https://${customDomain}`
    });
  }
}
