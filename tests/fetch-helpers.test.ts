import { describe, expect, it } from "vitest";
import { buildHeaders, rewriteUrl } from "../src/request/fetch";
import type { ClaudeModelRequest } from "../src/types";

describe("rewriteUrl", () => {
  it("rewrites responses endpoint to codex variant", () => {
    const base = "https://chatgpt.com/backend-api";
    const original = "https://chatgpt.com/backend-api/responses";
    const rewritten = rewriteUrl(base, original);
    expect(rewritten).toContain("/backend-api/codex/responses");
  });

  it("falls back to base when original invalid", () => {
    const base = "https://chatgpt.com/backend-api";
    const rewritten = rewriteUrl(base, "not-a-url");
    expect(rewritten).toContain("/codex/responses");
  });
});

describe("buildHeaders", () => {
  it("injects required headers and preserves existing ones", () => {
    const request: ClaudeModelRequest = {
      url: "https://chatgpt.com/backend-api/responses",
      headers: {
        "User-Agent": "claude-code",
      },
      stream: false,
    };

    const headers = buildHeaders(request, { accessToken: "token-123", accountId: "acct_1" }, "session-1");

    expect(headers.Authorization).toBe("Bearer token-123");
    expect(headers["x-openai-account-id"]).toBe("acct_1");
    expect(headers["x-openai-session-id"]).toBe("session-1");
    expect(headers["User-Agent"]).toBe("claude-code");
    expect(headers.Accept).toBe("application/json");
  });
});
