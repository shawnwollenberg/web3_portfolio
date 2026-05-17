import serverless from "serverless-http";
import { createApp } from "./app.js";

export const handler = serverless(createApp());

