import type { FastifyReply } from "fastify";
import type { AnthropicErrorPayload } from "./types";

export function createAnthropicError(type: string, message: string, status: number): AnthropicErrorPayload {
  return {
    type: "error",
    error: {
      type,
      message,
      status,
    },
  };
}

export function sendAnthropicError(reply: FastifyReply, type: string, message: string, status: number): void {
  const payload = createAnthropicError(type, message, status);
  reply.status(status).send(payload);
}

export function toAnthropicError(error: unknown, fallbackStatus = 500): {
  status: number;
  payload: AnthropicErrorPayload;
} {
  const status = resolveStatus(error) ?? fallbackStatus;
  const message = resolveMessage(error, status);
  const type = status === 401 ? "authentication_error" : status === 403 ? "authorization_error" : "api_error";
  return {
    status,
    payload: createAnthropicError(type, message, status),
  };
}

function resolveStatus(error: unknown): number | undefined {
  if (!error) {
    return undefined;
  }
  if (typeof error === "number") {
    return error;
  }
  if (typeof error === "object") {
    const maybe = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
    if (typeof maybe.status === "number") {
      return maybe.status;
    }
    if (typeof maybe.statusCode === "number") {
      return maybe.statusCode;
    }
    if (maybe.response && typeof maybe.response.status === "number") {
      return maybe.response.status;
    }
  }
  return undefined;
}

function resolveMessage(error: unknown, status: number): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (typeof error === "object" && error !== null) {
    const maybe = error as { message?: unknown; error?: { message?: unknown } };
    if (typeof maybe.message === "string") {
      return maybe.message;
    }
    if (maybe.error && typeof maybe.error.message === "string") {
      return maybe.error.message;
    }
  }
  if (status === 401) {
    return "Authentication required";
  }
  return "Unexpected error";
}

