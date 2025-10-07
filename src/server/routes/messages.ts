import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { buildClaudeRequest, codexResponseToAnthropic, pipeCodexStreamToAnthropic } from "../../proxy/anthropic-adapter";
import { toAnthropicError } from "../errors";
import type { MessagesPayload, ServerDeps } from "../types";
import { logProxyRequest } from "../../utils/request-log";

type AuthPreHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

interface MessagesRouteDeps extends ServerDeps {
  authPreHandler: AuthPreHandler;
}

interface MessagesQuery {
  bridge?: string;
}

export function registerMessagesRoute(server: FastifyInstance, deps: MessagesRouteDeps): void {
  server.post<{ Body: MessagesPayload; Querystring: MessagesQuery }>(
    "/v1/messages",
    {
      preHandler: deps.authPreHandler,
    },
    async (request, reply) => {
      if (reply.sent || reply.raw.headersSent) {
        return;
      }
      try {
        await logProxyRequest(deps.config, {
          type: "messages",
          body: request.body,
          headers: request.headers as Record<string, unknown>,
          query: request.query as Record<string, unknown>,
        }).catch((error) => {
          deps.logger.warn("Failed to log incoming request", {
            error: error instanceof Error ? error.message : String(error),
          });
        });

        const body = validateBody(request.body);
        const bridgeOverride = parseBridgeOverride(request.query?.bridge);
        const stream = determineStreamPreference(body, request.headers);
        const claudeRequest = buildClaudeRequest(body, {
          config: deps.config,
          headers: normalizeHeaders(request.headers),
          stream,
          bridgePromptOverride: bridgeOverride,
        });

        const response = await deps.pipeline.handle(claudeRequest);

        if (stream || response.stream) {
          await streamResponse(reply, response.stream, {
            headers: response.headers as Record<string, string>,
            status: response.status,
          });
          return;
        }

        const anthropicResponse = codexResponseToAnthropic(response, deps.config);
        reply.status(response.status).send(anthropicResponse);
      } catch (error) {
        if (!reply.sent && !reply.raw.headersSent) {
          const mapped = toAnthropicError(error);
          reply.status(mapped.status).send(mapped.payload);
        }
      }
    },
  );
}

function validateBody(body: MessagesPayload | undefined): MessagesPayload {
  if (!body || typeof body !== "object") {
    throw new Error("Request body must be a JSON object");
  }
  if (!Array.isArray(body.messages)) {
    throw new Error("`messages` must be an array");
  }
  return body;
}

function parseBridgeOverride(value?: string): boolean | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") {
    return true;
  }
  if (normalized === "0" || normalized === "false") {
    return false;
  }
  return undefined;
}

function determineStreamPreference(body: MessagesPayload, headers: FastifyRequest["headers"]): boolean {
  if (typeof body.stream === "boolean") {
    return body.stream;
  }
  const accept = headers["accept"];
  if (typeof accept === "string" && accept.includes("text/event-stream")) {
    return true;
  }
  return false;
}

function normalizeHeaders(headers: FastifyRequest["headers"]): Record<string, string | undefined> {
  const normalised: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      normalised[key] = value;
    } else if (Array.isArray(value)) {
      normalised[key] = value[0];
    }
  }
  return normalised;
}

async function streamResponse(
  reply: FastifyReply,
  stream: AsyncIterable<string> | undefined,
  response: { headers: Record<string, string>; status: number },
): Promise<void> {
  reply.raw.statusCode = response.status ?? 200;
  reply.raw.setHeader("Content-Type", "text/event-stream");
  reply.raw.setHeader("Cache-Control", "no-cache");
  reply.raw.setHeader("Connection", "keep-alive");
  for (const [key, value] of Object.entries(response.headers)) {
    if (!reply.raw.hasHeader(key)) {
      reply.raw.setHeader(key, value);
    }
  }
  reply.hijack();
  reply.raw.write(": keep-alive\n\n");

  if (!stream) {
    reply.raw.end();
    return;
  }

  await pipeCodexStreamToAnthropic(stream, (chunk) => {
    reply.raw.write(chunk);
  });
  reply.raw.end();
}
