import { createApp } from "./app.js";
import { config } from "./config.js";

const app = createApp();

app.listen(config.port, () => {
  console.log(`WalletLens API listening on http://localhost:${config.port}`);
  console.log(`x402 dev bypass: ${config.x402DevBypass}`);
  console.log(`x402 facilitator: ${config.x402FacilitatorUrl}`);
  console.log(`x402 network: ${config.x402Network}`);
  console.log(`bazaar eligible: ${config.bazaarEligible}`);
});
