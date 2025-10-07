import { AuthManager } from "../auth";
import { CodexConfig, ClaudeModelRequest, ClaudeModelResponse, Logger } from "../types";
import { maskToken } from "../utils/logger";
import { transformRequest, shouldInjectPrompt } from "./transformer";
import { headersToObject, responseToJson, toAsyncIterable } from "./response";

type FetchResponse = globalThis.Response;

interface FetchPipelineDeps {
  config: CodexConfig;
  auth: AuthManager;
  logger: Logger;
}

export function rewriteUrl(baseUrl: string, originalUrl?: string): string {
  const base = new URL(baseUrl);
  if (originalUrl) {
    try {
      const input = new URL(originalUrl);
      input.pathname = input.pathname.replace(/\/responses$/u, "/codex/responses");
      input.pathname = input.pathname.replace(/\/backend-api\/?/, "/backend-api/");
      input.host = base.host;
      input.protocol = base.protocol;
      return input.toString();
    } catch {
      /* fallthrough */
    }
  }

  base.pathname = "/codex/responses";
  return base.toString();
}

export function buildHeaders(
  request: ClaudeModelRequest,
  token: { accessToken: string; accountId?: string },
  sessionId: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: request.stream ? "text/event-stream" : "application/json",
    "Content-Type": "application/json",
    "OpenAI-Beta": "responses=experimental",
    "x-openai-session-id": sessionId,
    Authorization: `Bearer ${token.accessToken}`,
    "x-openai-origin": "claude-code-codex",
    "x-openai-client-type": "claude-code-extension",
  };

  for (const [key, value] of Object.entries(request.headers ?? {})) {
    headers[key] = value;
  }

  if (token.accountId) {
    headers["x-openai-account-id"] = token.accountId;
  }

  return headers;
}

export function isEventStreamResponse(response: FetchResponse): boolean {
  const contentType = response.headers.get("content-type") || "";
  return contentType.includes("text/event-stream");
}

export class CodexFetchPipeline {
  private readonly config: CodexConfig;
  private readonly auth: AuthManager;
  private readonly logger: Logger;

  constructor(deps: FetchPipelineDeps) {
    this.config = deps.config;
    this.auth = deps.auth;
    this.logger = deps.logger;
  }

  async handle(request: ClaudeModelRequest): Promise<ClaudeModelResponse> {
    const sessionId = this.auth.createSessionId();
    const token = await this.auth.getToken();
    const targetUrl = rewriteUrl(this.config.baseUrl, request.url);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const headersInput = { ...(request.headers ?? {}) };

    const bridgeOverrideHeaderKey = Object.keys(headersInput).find((key) =>
      key.toLowerCase() === "x-codex-bridge-override",
    );
    let bridgeOverride: boolean | undefined = request.bridgePromptOverride;
    if (bridgeOverrideHeaderKey) {
      const rawValue = headersInput[bridgeOverrideHeaderKey];
      delete headersInput[bridgeOverrideHeaderKey];
      if (typeof rawValue === "string") {
        const normalized = rawValue.trim().toLowerCase();
        if (normalized === "1" || normalized === "true") {
          bridgeOverride = true;
        } else if (normalized === "0" || normalized === "false") {
          bridgeOverride = false;
        }
      }
    }

    this.logger.debug("Codex request (pre-transform)", {
      url: targetUrl,
      headers: Object.keys(headersInput),
      hasTools: Array.isArray((body as { tools?: unknown[] }).tools),
    });

    const shouldInject = shouldInjectPrompt(this.config, body);
    const injectPrompt = bridgeOverride ?? shouldInject;
    const { body: transformed, injectedBridgePrompt } = transformRequest(this.config, body, {
      injectPrompt,
    });

    const headers = buildHeaders({ ...request, headers: headersInput }, token, sessionId);
    const maskedAuth = maskToken(token.accessToken);

    this.logger.debug("Codex request (post-transform)", {
      url: targetUrl,
      injectedBridgePrompt,
      maskedAuth,
    });

    const response = await fetch(targetUrl, {
      method: request.method ?? "POST",
      headers,
      body: JSON.stringify(transformed),
    });

    const summaryHeaders = headersToObject(response.headers);
    this.logger.debug("Codex response received", {
      status: response.status,
      contentType: response.headers.get("content-type"),
    });

    if (request.stream || isEventStreamResponse(response)) {
      return {
        status: response.status,
        headers: summaryHeaders,
        stream: toAsyncIterable(response),
      };
    }

    const payload = await responseToJson(response);

    return {
      status: response.status,
      headers: summaryHeaders,
      body: payload,
    };
  }
}
