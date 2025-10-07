import { describe, expect, it } from "vitest";
import { transformRequest, shouldInjectPrompt } from "../src/request/transformer";
import { loadConfig } from "../src/config";

async function getConfig(overrides: Partial<NodeJS.ProcessEnv> = {}) {
  return loadConfig({
    CLAUDE_CODE_CODEX_DEBUG: "0",
    ...overrides,
  } as NodeJS.ProcessEnv);
}

describe("transformRequest", () => {
  it("normalises model id and removes stateless artifacts", async () => {
    const config = await getConfig();
    const body = {
      model: "gpt-5",
      rs_tmp: "remove-me",
      messages: [],
    } as Record<string, unknown>;

    const result = transformRequest(config, body);

    expect(result.body.model).toBe("gpt-5-codex");
    expect("rs_tmp" in result.body).toBe(false);
    expect(result.body.store).toBe(false);
    expect(Array.isArray(result.body.input)).toBe(true);
  });

  it("preserves instructions in the transformed payload", async () => {
    const config = await getConfig();
    const body = {
      instructions: "You are Claude Code.",
      messages: [{ role: "user", content: "hello" }],
    } as Record<string, unknown>;

    const result = transformRequest(config, body);

    expect(result.body.instructions).toBe("You are Claude Code.");
  });

  it("injects bridge prompt when tools are present in auto mode", async () => {
    const config = await getConfig({ CODEX_MODE: "auto" });
    const body = {
      tools: [{ name: "bash" }],
      messages: [{ role: "user", content: "hi" }],
    } as Record<string, unknown>;

    const result = transformRequest(config, body);

    const first = (result.body.input as Array<{ role: string; content: Array<{ type: string; text: string }> }>)[0];
    expect(first.role).toBe("developer");
    expect(first.content[0]?.text).toContain("Codex Running in Claude Code");
  });

  it("does not inject bridge prompt by default", async () => {
    const config = await getConfig();
    const body = {
      tools: [{ name: "bash" }],
      messages: [{ role: "user", content: "hi" }],
    } as Record<string, unknown>;

    const result = transformRequest(config, body);

    const first = (result.body.input as Array<{ role: string }>)[0];
    expect(first.role).toBe("user");
  });

  it("skips prompt injection when disabled explicitly", async () => {
    const config = await getConfig({ CODEX_MODE: "disabled" });
    const body = {
      tools: [{ name: "read" }],
    } as Record<string, unknown>;

    const result = transformRequest(config, body);

    expect(result.injectedBridgePrompt).toBe(false);
  });
});

describe("shouldInjectPrompt", () => {
  it("returns true when tools present in auto mode", async () => {
    const config = await getConfig({ CODEX_MODE: "auto" });
    const body = { tools: [{ name: "bash" }] } as Record<string, unknown>;
    expect(shouldInjectPrompt(config, body)).toBe(true);
  });

  it("returns false by default when tools present", async () => {
    const config = await getConfig();
    const body = { tools: [{ name: "bash" }] } as Record<string, unknown>;
    expect(shouldInjectPrompt(config, body)).toBe(false);
  });

  it("returns false when disabled", async () => {
    const config = await getConfig({ CODEX_MODE: "0" });
    const body = { tools: [{ name: "bash" }] } as Record<string, unknown>;
    expect(shouldInjectPrompt(config, body)).toBe(false);
  });
});
