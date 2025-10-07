import type { FastifyReply, FastifyRequest } from "fastify";
import type { Logger } from "../types";
import type { ProxyConfig } from "./types";
import { sendAnthropicError } from "./errors";

export function createAuthPreHandler(config: ProxyConfig, logger: Logger) {
  return async function authPreHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!config.authToken) {
      sendAnthropicError(reply, "configuration_error", "Proxy auth token is not configured", 500);
      return;
    }

    const provided = extractToken(request);
    if (!provided) {
      logger.warn("Missing Authorization header on proxy request");
      sendAnthropicError(reply, "authentication_error", "Missing Authorization bearer token", 401);
      return;
    }

    if (provided !== config.authToken) {
      logger.warn("Invalid Authorization token provided", { provided: mask(provided) });
      sendAnthropicError(reply, "authentication_error", "Invalid authentication token", 401);
      return;
    }
  };
}

function extractToken(request: FastifyRequest): string | undefined {
  const authHeader = request.headers["authorization"];
  if (typeof authHeader === "string") {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  const apiKey = request.headers["x-api-key"];
  if (typeof apiKey === "string" && apiKey.trim()) {
    return apiKey.trim();
  }
  return undefined;
}

function mask(token: string): string {
  if (token.length <= 4) {
    return "***";
  }
  return `${token.slice(0, 2)}***${token.slice(-2)}`;
}

