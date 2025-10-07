import type { OutgoingHttpHeaders } from "http";

export interface CodexConfig {
  baseUrl: string;
  cacheDir: string;
  authPath: string;
  bridgePromptCachePath: string;
  debug: boolean;
  promptInjectionStrategy: "auto" | "force" | "disabled";
  defaults: {
    reasoningEffort: "low" | "medium" | "high";
    reasoningSummary: "auto" | "always" | "never";
    textVerbosity: "low" | "medium" | "high";
    include: string[];
  };
  oauth: {
    clientId: string;
    authorizeUrl: string;
    tokenUrl: string;
    redirectUri: string;
    scope: string;
  };
  accountId?: string;
}

export interface CodexTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId?: string;
}

export interface Logger {
  debug: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string | Error, meta?: Record<string, unknown>) => void;
}

export interface ClaudeModelRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  stream?: boolean;
  bridgePromptOverride?: boolean;
}

export interface ClaudeModelResponse {
  status: number;
  headers: OutgoingHttpHeaders;
  body?: unknown;
  stream?: AsyncIterable<string>;
}

export interface ModelTransport {
  id: string;
  models: string[];
  send: (request: ClaudeModelRequest) => Promise<ClaudeModelResponse>;
}

export interface ClaudeExtensionContext {
  registerTransport: (transport: ModelTransport) => void | Promise<void>;
  logger?: Logger;
}
