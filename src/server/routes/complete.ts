import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { buildClaudeRequestFromPrompt, codexResponseToAnthropic, pipeCodexStreamToAnthropic } from "../../proxy/anthropic-adapter";
import { toAnthropicError } from "../errors";
import type { AnthropicMessageResponse, CompletePayload, MessagesPayload, ServerDeps } from "../types";
import { logProxyRequest } from "../../utils/request-log";

interface CompleteQuery {
  bridge?: string;
}

type AuthPreHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

interface CompleteRouteDeps extends ServerDeps {
  authPreHandler: AuthPreHandler;
}

export function registerCompleteRoute(server: FastifyInstance, deps: CompleteRouteDeps): void {
  server.post<{ Body: CompletePayload; Querystring: CompleteQuery }>(
    "/v1/complete",
    {
      preHandler: deps.authPreHandler,
    },
    async (request, reply) => {
      if (reply.sent || reply.raw.headersSent) {
        return;
      }
      try {
        await logProxyRequest(deps.config, {
          type: "complete",
          body: request.body,
          headers: request.headers as Record<string, unknown>,
          query: request.query as Record<string, unknown>,
        }).catch((error) => {
          deps.logger.warn("Failed to log incoming request", {
            error: error instanceof Error ? error.message : String(error),
          });
        });

        const body = validateComplete(request.body);
        const bridgeOverride = parseBridgeOverride(request.query?.bridge);
        const stream = determineStreamPreference(body, request.headers);
        const { request: claudeRequest, original } = buildClaudeRequestFromPrompt(body, {
          config: deps.config,
          headers: normalizeHeaders(request.headers),
          stream,
          bridgePromptOverride: bridgeOverride,
        });

        const response = await deps.pipeline.handle(claudeRequest);

        if (stream || response.stream) {
          await streamCompletion(reply, response.stream, response.status, response.headers as Record<string, string>);
          return;
        }

        const anthropicResponse = codexResponseToAnthropic(response, deps.config);
        reply.status(response.status).send(convertToCompletion(anthropicResponse, original));
      } catch (error) {
        if (!reply.sent && !reply.raw.headersSent) {
          const mapped = toAnthropicError(error);
          reply.status(mapped.status).send(mapped.payload);
        }
      }
    },
  );
}

function validateComplete(body: CompletePayload | undefined): CompletePayload {
  if (!body || typeof body !== "object") {
    throw new Error("Request body must be a JSON object");
  }
  if (typeof body.prompt !== "string") {
    throw new Error("`prompt` must be a string");
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

function determineStreamPreference(body: CompletePayload, headers: FastifyRequest["headers"]): boolean {
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

async function streamCompletion(
  reply: FastifyReply,
  stream: AsyncIterable<string> | undefined,
  status: number,
  headers: Record<string, string>,
): Promise<void> {
  reply.raw.statusCode = status ?? 200;
  reply.raw.setHeader("Content-Type", "text/event-stream");
  reply.raw.setHeader("Cache-Control", "no-cache");
  reply.raw.setHeader("Connection", "keep-alive");
  for (const [key, value] of Object.entries(headers)) {
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

function convertToCompletion(response: AnthropicMessageResponse, original: MessagesPayload) {
  const textBlock = response.content.find((item) => item.type === "text");
  const completion = textBlock && "text" in textBlock ? textBlock.text : "";
  return {
    id: response.id,
    type: "completion",
    model: response.model,
    completion,
    stop_reason: response.stop_reason ?? "end_turn",
    stop: response.stop_sequence ?? null,
    usage: response.usage,
    original_prompt: original.messages[0]?.content ?? "",
  };
}
