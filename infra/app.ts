import "dotenv/config";
import * as cdk from "aws-cdk-lib";
import { Web3PortfolioStack } from "./web3-portfolio-stack.js";

const app = new cdk.App();

new Web3PortfolioStack(app, "Web3PortfolioStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.DEPLOY_REGION || process.env.AWS_REGION || "us-east-2"
  }
});
