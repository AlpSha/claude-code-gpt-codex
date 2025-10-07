import { describe, expect, it } from "vitest";
import { transformRequest, shouldInjectPrompt } from "../src/request/transformer";
import { loadConfig } from "../src/config";

async function getConfig() {
  return loadConfig({
    CLAUDE_CODE_CODEX_DEBUG: "0",
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
  });

  it("injects bridge prompt when tools are present", async () => {
    const config = await getConfig();
    const body = {
      tools: [{ name: "bash" }],
      messages: [{ role: "user", content: "hi" }],
    } as Record<string, unknown>;

    const result = transformRequest(config, body);

    const first = (result.body.messages as Array<{ role: string; content: string }>)[0];
    expect(first.role).toBe("developer");
    expect(first.content).toContain("Codex Running in Claude Code");
  });

  it("skips prompt injection when disabled", async () => {
    const config = await loadConfig({ CODEX_MODE: "disabled" } as NodeJS.ProcessEnv);
    const body = {
      tools: [{ name: "read" }],
    } as Record<string, unknown>;

    const result = transformRequest(config, body);

    expect(result.injectedBridgePrompt).toBe(false);
  });
});

describe("shouldInjectPrompt", () => {
  it("returns true when tools present in auto mode", async () => {
    const config = await getConfig();
    const body = { tools: [{ name: "bash" }] } as Record<string, unknown>;
    expect(shouldInjectPrompt(config, body)).toBe(true);
  });

  it("returns false when disabled", async () => {
    const config = await loadConfig({ CODEX_MODE: "0" } as NodeJS.ProcessEnv);
    const body = { tools: [{ name: "bash" }] } as Record<string, unknown>;
    expect(shouldInjectPrompt(config, body)).toBe(false);
  });
});
