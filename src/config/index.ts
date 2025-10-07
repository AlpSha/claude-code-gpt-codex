import path from "path";
import os from "os";
import { CodexConfig } from "../types";
import type { ProxyConfig } from "../server/types";
import { expandHomePath, readJsonFile } from "../utils/fs";

interface RawConfigOverrides {
  baseUrl?: string;
  cacheDir?: string;
  authPath?: string;
  bridgePromptCachePath?: string;
  debug?: boolean;
  promptInjectionStrategy?: "auto" | "force" | "disabled";
  accountId?: string;
  defaults?: Partial<CodexConfig["defaults"]>;
  allowedModels?: string[];
  authToken?: string;
  host?: string;
  port?: number;
  proxy?: {
    host?: string;
    port?: number;
    authToken?: string;
    allowedModels?: string[];
  };
}

const DEFAULT_BASE_URL = "https://chatgpt.com/backend-api";
const DEFAULT_CACHE_DIR = path.join(os.homedir(), ".claude", "cache");
const DEFAULT_AUTH_PATH = path.join(os.homedir(), ".claude", "auth", "codex.json");
const DEFAULT_BRIDGE_CACHE = path.join(DEFAULT_CACHE_DIR, "claude-tooling-bridge.txt");
const DEFAULT_PROMPT_STRATEGY: CodexConfig["promptInjectionStrategy"] = "disabled";

const DEFAULT_ALLOWED_MODELS = ["gpt-5-codex", "gpt-5"];
const DEFAULT_PROXY_PORT = 4000;

const DEFAULT_CONFIG: CodexConfig = {
  baseUrl: DEFAULT_BASE_URL,
  cacheDir: DEFAULT_CACHE_DIR,
  authPath: DEFAULT_AUTH_PATH,
  bridgePromptCachePath: DEFAULT_BRIDGE_CACHE,
  debug: false,
  promptInjectionStrategy: DEFAULT_PROMPT_STRATEGY,
  defaults: {
    reasoningEffort: "medium",
    reasoningSummary: "auto",
    textVerbosity: "medium",
    include: ["reasoning.encrypted_content"],
  },
  oauth: {
    clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
    authorizeUrl: "https://auth.openai.com/oauth/authorize",
    tokenUrl: "https://auth.openai.com/oauth/token",
    redirectUri: "http://localhost:1455/auth/callback",
    scope: "openid profile email offline_access",
  },
};

function envBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return value === "1" || value.toLowerCase() === "true";
}

function envPromptMode(value: string | undefined): CodexConfig["promptInjectionStrategy"] | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "1" || value.toLowerCase() === "force") {
    return "force";
  }
  if (value === "0" || value.toLowerCase() === "disable" || value.toLowerCase() === "disabled") {
    return "disabled";
  }
  if (value.toLowerCase() === "auto") {
    return "auto";
  }
  return undefined;
}

export async function loadConfig(env: NodeJS.ProcessEnv = process.env): Promise<ProxyConfig> {
  const configPath = env.CLAUDE_CODE_CODEX_CONFIG ? expandHomePath(env.CLAUDE_CODE_CODEX_CONFIG) : undefined;
  let fileOverrides: RawConfigOverrides = {};
  if (configPath) {
    const parsed = await readJsonFile<RawConfigOverrides>(configPath);
    if (parsed) {
      fileOverrides = parsed;
    }
  }

  const proxyOverrides = fileOverrides.proxy ?? {};

  const allowedModelsEnv = env.ANTHROPIC_ALLOWED_MODELS?.split(",")
    .map((model) => model.trim())
    .filter((model) => model.length > 0);

  const parsedEnvPort = env.PROXY_PORT ? Number.parseInt(env.PROXY_PORT, 10) : undefined;
  const rawFilePort = fileOverrides.port ?? proxyOverrides.port;
  const parsedFilePort =
    typeof rawFilePort === "string" ? Number.parseInt(rawFilePort, 10) : rawFilePort;

  const merged: ProxyConfig = {
    ...DEFAULT_CONFIG,
    ...fileOverrides,
    baseUrl: env.CLAUDE_CODE_CODEX_BASE_URL || fileOverrides.baseUrl || DEFAULT_CONFIG.baseUrl,
    cacheDir: expandHomePath(env.CLAUDE_CODE_CODEX_CACHE_DIR || fileOverrides.cacheDir || DEFAULT_CONFIG.cacheDir),
    authPath: expandHomePath(env.CLAUDE_CODE_CODEX_AUTH_PATH || fileOverrides.authPath || DEFAULT_CONFIG.authPath),
    bridgePromptCachePath: expandHomePath(
      env.CLAUDE_CODE_CODEX_BRIDGE_CACHE || fileOverrides.bridgePromptCachePath || DEFAULT_CONFIG.bridgePromptCachePath,
    ),
    debug: envBoolean(env.CLAUDE_CODE_CODEX_DEBUG, fileOverrides.debug ?? DEFAULT_CONFIG.debug),
    promptInjectionStrategy:
      envPromptMode(env.CODEX_MODE) || fileOverrides.promptInjectionStrategy || DEFAULT_CONFIG.promptInjectionStrategy,
    oauth: {
      ...DEFAULT_CONFIG.oauth,
    },
    defaults: {
      ...DEFAULT_CONFIG.defaults,
      ...fileOverrides.defaults,
    },
    accountId: env.CLAUDE_CODE_CODEX_ACCOUNT_ID || fileOverrides.accountId || DEFAULT_CONFIG.accountId,
    host: env.PROXY_HOST || fileOverrides.host || proxyOverrides.host || "127.0.0.1",
    port:
      (parsedEnvPort !== undefined && Number.isFinite(parsedEnvPort) && parsedEnvPort > 0)
        ? parsedEnvPort
        : typeof parsedFilePort === "number" && Number.isFinite(parsedFilePort) && parsedFilePort > 0
          ? parsedFilePort
          : DEFAULT_PROXY_PORT,
    authToken: env.ANTHROPIC_AUTH_TOKEN || fileOverrides.authToken || proxyOverrides.authToken || "",
    allowedModels:
      allowedModelsEnv?.length
        ? allowedModelsEnv
        : proxyOverrides.allowedModels?.length
          ? proxyOverrides.allowedModels
          : fileOverrides.allowedModels?.length
            ? fileOverrides.allowedModels
            : DEFAULT_ALLOWED_MODELS,
  };

  return merged;
}
