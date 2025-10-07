import { describe, expect, it } from "vitest";
import { createAuthPreHandler } from "../src/server/auth";
import type { ProxyConfig } from "../src/server/types";
import type { Logger } from "../src/types";

const CONFIG: ProxyConfig = {
  baseUrl: "https://chatgpt.com/backend-api",
  cacheDir: "/tmp/cache",
  authPath: "/tmp/auth.json",
  bridgePromptCachePath: "/tmp/bridge.txt",
  debug: false,
  promptInjectionStrategy: "auto",
  defaults: {
    reasoningEffort: "medium",
    reasoningSummary: "auto",
    textVerbosity: "medium",
    include: ["reasoning.encrypted_content"],
  },
  oauth: {
    clientId: "client",
    authorizeUrl: "https://auth.example/authorize",
    tokenUrl: "https://auth.example/token",
    redirectUri: "http://localhost:1455/auth/callback",
    scope: "openid",
  },
  allowedModels: ["gpt-5-codex"],
  authToken: "secret",
  host: "127.0.0.1",
  port: 4000,
};

const LOGGER: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe("createAuthPreHandler", () => {
  it("allows valid bearer tokens", async () => {
    const preHandler = createAuthPreHandler(CONFIG, LOGGER);
    const request = { headers: { authorization: "Bearer secret" } } as any;
    const reply = createReply();
    await preHandler(request, reply);
    expect(reply.sent).toBe(false);
  });

  it("rejects missing authorization", async () => {
    const preHandler = createAuthPreHandler(CONFIG, LOGGER);
    const request = { headers: {} } as any;
    const reply = createReply();
    await preHandler(request, reply);
    expect(reply.sent).toBe(true);
    expect(reply.statusCode).toBe(401);
  });

  it("rejects invalid token", async () => {
    const preHandler = createAuthPreHandler(CONFIG, LOGGER);
    const request = { headers: { authorization: "Bearer nope" } } as any;
    const reply = createReply();
    await preHandler(request, reply);
    expect(reply.statusCode).toBe(401);
  });
});

function createReply() {
  return {
    sent: false,
    statusCode: 0,
    payload: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(payload: unknown) {
      this.sent = true;
      this.payload = payload;
      return this;
    },
  };
}

