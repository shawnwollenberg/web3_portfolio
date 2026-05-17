import { createApp } from "./app.js";
import { config } from "./config.js";

const app = createApp();

app.listen(config.port, () => {
  console.log(`WalletLens API listening on http://localhost:${config.port}`);
  console.log(`x402 dev bypass: ${config.x402DevBypass}`);
});
