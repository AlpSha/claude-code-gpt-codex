import { loadConfig } from "./config";
import { createLogger } from "./utils/logger";
import { ensureBridgePromptCached } from "./prompts/claude-bridge";
import { AuthManager } from "./auth";
import { CodexFetchPipeline } from "./request/fetch";
import type { ClaudeExtensionContext, ModelTransport } from "./types";
import type { ProxyConfig } from "./server/types";

export async function activate(context: ClaudeExtensionContext): Promise<void> {
  const config = (await loadConfig()) as ProxyConfig;
  const logger = context.logger ?? createLogger(config.debug);

  if (config.debug) {
    logger.info("Loaded Codex configuration", {
      baseUrl: config.baseUrl,
      cacheDir: config.cacheDir,
      promptInjectionStrategy: config.promptInjectionStrategy,
    });
  }

  await ensureBridgePromptCached(config.bridgePromptCachePath);

  const auth = new AuthManager(config, logger);
  const pipeline = new CodexFetchPipeline({ config, auth, logger });

  const transport: ModelTransport = {
    id: "codex-gateway",
    models: config.allowedModels,
    send: async (request) => pipeline.handle(request),
  };

  await context.registerTransport(transport);
}

export default {
  activate,
};
