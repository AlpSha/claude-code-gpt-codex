import { loadConfig } from "./config";
import { createLogger } from "./utils/logger";
import { ensureBridgePromptCached } from "./prompts/claude-bridge";
import { AuthManager } from "./auth";
import { CodexFetchPipeline } from "./request/fetch";
import { createServer } from "./server/app";
import type { ProxyConfig } from "./server/types";
import { activate } from "./extension";

export async function startProxy(): Promise<void> {
  const config = (await loadConfig()) as ProxyConfig;
  const logger = createLogger(config.debug);

  if (!config.authToken) {
    throw new Error("ANTHROPIC_AUTH_TOKEN is required to start the proxy");
  }

  await ensureBridgePromptCached(config.bridgePromptCachePath);

  const auth = new AuthManager(config, logger);
  const pipeline = new CodexFetchPipeline({ config, auth, logger });
  const server = createServer({ config, logger, pipeline });

  await server.listen({ port: config.port, host: config.host });

  logger.info("Anthropic proxy listening", {
    host: config.host,
    port: config.port,
    allowedModels: config.allowedModels,
  });
}

export { activate };

if (import.meta.main) {
  startProxy().catch((error) => {
    console.error("Failed to start proxy", error);
    process.exit(1);
  });
}
