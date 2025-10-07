import fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { createAuthPreHandler } from "./auth";
import { registerMessagesRoute } from "./routes/messages";
import { registerCompleteRoute } from "./routes/complete";
import type { ServerDeps } from "./types";

export function createServer(deps: ServerDeps): FastifyInstance {
  const server = fastify({ logger: false });
  const authPreHandler = createAuthPreHandler(deps.config, deps.logger);

  server.setErrorHandler((error, request, reply) => {
    deps.logger.error(error instanceof Error ? error : new Error(String(error)));
    if (reply.sent) {
      return;
    }
    reply.status(500).send({
      type: "error",
      error: {
        type: "internal_server_error",
        message: error instanceof Error ? error.message : "Unexpected error",
        status: 500,
      },
    });
  });

  registerMessagesRoute(server, { ...deps, authPreHandler });
  registerCompleteRoute(server, { ...deps, authPreHandler });

  return server;
}

