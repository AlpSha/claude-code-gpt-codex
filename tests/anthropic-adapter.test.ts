import { describe, expect, it } from "vitest";
import {
  buildClaudeRequest,
  buildClaudeRequestFromPrompt,
  codexResponseToAnthropic,
  pipeCodexStreamToAnthropic,
} from "../src/proxy/anthropic-adapter";
import type { MessagesPayload, ProxyConfig } from "../src/server/types";

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
  allowedModels: ["gpt-5-codex", "gpt-5"],
  authToken: "secret",
  host: "127.0.0.1",
  port: 4000,
};

describe("buildClaudeRequest", () => {
  it("maps Anthropic payload into Claude request format", () => {
    const payload: MessagesPayload = {
      model: "gpt-5",
      system: "be concise",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "hello" },
            { type: "tool_result", tool_use_id: "tool_1", content: "done" },
          ],
        },
      ],
      metadata: { user_id: "user-123" },
      max_tokens: 256,
      temperature: 0.2,
      tools: [
        {
          name: "bash",
          description: "Run shell commands",
          input_schema: { type: "object" },
        },
      ],
    };

    const request = buildClaudeRequest(payload, {
      config: CONFIG,
      headers: {
        "anthropic-version": "2023-01-01",
        authorization: "Bearer anthropic-key",
        host: "127.0.0.1:4000",
        "content-length": "123",
        "accept-encoding": "gzip",
      },
      stream: false,
      bridgePromptOverride: true,
    });

    expect(request.url.endsWith("/responses")).toBe(true);
    const body = request.body as Record<string, unknown>;
    expect(body.model).toBe("gpt-5-codex");
    expect(body.instructions).toBe("be concise");
    expect(body.max_output_tokens).toBe(256);
    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.stream).toBe(true);
    expect(request.headers?.["anthropic-version"]).toBe("2023-01-01");
    expect(request.headers?.authorization).toBeUndefined();
    expect(request.headers?.host).toBeUndefined();
    expect(request.headers?.["content-length"]).toBeUndefined();
    expect(request.headers?.["accept-encoding"]).toBeUndefined();
    expect(request.headers?.user_id).toBe("user-123");
    expect(request.bridgePromptOverride).toBe(true);

    const [firstMessage] = body.messages as Array<{ content: string }>;
    expect(firstMessage.content).toContain("hello");
    expect(firstMessage.content).toContain("tool_result:tool_1");

    const tools = body.tools as Array<Record<string, unknown>>;
    expect(tools[0]).toMatchObject({ type: "function" });
  });
});

describe("buildClaudeRequestFromPrompt", () => {
  it("wraps prompt into Anthropic messages payload", () => {
    const { request, original } = buildClaudeRequestFromPrompt(
      {
        prompt: "Say hi",
        max_tokens: 32,
        stream: true,
      },
      {
        config: CONFIG,
        headers: {},
        stream: true,
      },
    );

    expect(original.messages[0]?.content).toBe("Say hi");
    const body = request.body as Record<string, unknown>;
    expect(body.max_output_tokens).toBe(32);
    expect(request.stream).toBe(true);
  });
});

describe("codexResponseToAnthropic", () => {
  it("extracts assistant text content", () => {
    const response = codexResponseToAnthropic(
      {
        status: 200,
        headers: {},
        body: {
          id: "resp_123",
          model: "gpt-5-codex",
          usage: { input_tokens: 10, output_tokens: 20 },
          output: [
            {
              content: [
                { type: "output_text", text: "hello" },
                { type: "tool_call", id: "tool_1", name: "bash", arguments: { cmd: "ls" } },
              ],
            },
          ],
        },
      },
      CONFIG,
    );

    expect(response.id).toBe("resp_123");
    expect(response.content[0]).toMatchObject({ type: "text" });
    expect(response.content[1]).toMatchObject({ type: "tool_use" });
    expect(response.usage).toMatchObject({ input_tokens: 10 });
  });
});

describe("pipeCodexStreamToAnthropic", () => {
  it("translates response events into Anthropic SSE", async () => {
    const events = [
      "event: response.created\ndata: {\"id\":\"resp_1\",\"model\":\"gpt-5-codex\"}\n\n",
      "event: response.output_text.delta\ndata: {\"delta\":\"Hello\"}\n\n",
      "event: response.output_text.done\ndata: {}\n\n",
      "event: response.completed\ndata: {\"stop_reason\":\"end_turn\",\"usage\":{\"output_tokens\":5}}\n\n",
    ];

    const chunks: string[] = [];
    await pipeCodexStreamToAnthropic(
      (async function* () {
        for (const event of events) {
          yield event;
        }
      })(),
      (chunk) => {
        chunks.push(chunk);
      },
    );

    const joined = chunks.join("");
    expect(joined).toContain("message_start");
    expect(joined).toContain("content_block_delta");
    expect(joined).toContain("message_end");
    expect(joined.endsWith("data: [DONE]\n\n")).toBe(true);
  });
});
