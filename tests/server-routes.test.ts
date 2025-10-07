import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "../src/server/app";
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

describe("messages route", () => {
  let server: ReturnType<typeof createServer>;
  const handle = vi.fn();

  beforeEach(() => {
    handle.mockResolvedValue({
      status: 200,
      headers: {},
      body: {
        id: "resp_1",
        model: "gpt-5-codex",
        output_text: "hello",
        usage: { output_tokens: 5 },
      },
    });
    server = createServer({
      config: CONFIG,
      logger: LOGGER,
      pipeline: { handle } as any,
    });
  });

  afterEach(async () => {
    await server.close();
  });

  it("returns Anthropic-compatible response", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/v1/messages",
      headers: {
        authorization: "Bearer secret",
      },
      payload: {
        model: "gpt-5-codex",
        messages: [{ role: "user", content: "Hello" }],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { type: string; content: Array<{ type: string }> };
    expect(body.type).toBe("message");
    expect(body.content[0].type).toBe("text");
  });

  it("enforces auth token", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/v1/messages",
      payload: {
        messages: [],
      },
    });

    expect(response.statusCode).toBe(401);
  });
});

