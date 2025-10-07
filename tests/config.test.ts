import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { loadConfig } from "../src/config";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "codex-config-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("merges environment variables over defaults", async () => {
    const env = {
      CLAUDE_CODE_CODEX_BASE_URL: "https://example.com/backend-api",
      CLAUDE_CODE_CODEX_CACHE_DIR: path.join(tmpDir, "cache"),
      CLAUDE_CODE_CODEX_AUTH_PATH: path.join(tmpDir, "auth.json"),
      CLAUDE_CODE_CODEX_DEBUG: "1",
      CODEX_MODE: "1",
    } as NodeJS.ProcessEnv;

    const config = await loadConfig(env);

    expect(config.baseUrl).toEqual("https://example.com/backend-api");
    expect(config.cacheDir).toContain(tmpDir);
    expect(config.authPath).toContain("auth.json");
    expect(config.debug).toBe(true);
    expect(config.promptInjectionStrategy).toBe("force");
    expect(config.port).toBe(4000);
    expect(config.host).toBe("127.0.0.1");
    expect(config.allowedModels.length).toBeGreaterThan(0);
  });

  it("merges config file overrides", async () => {
    const configPath = path.join(tmpDir, "override.json");
    await writeFile(
      configPath,
      JSON.stringify({
        baseUrl: "https://override.test",
        defaults: {
          reasoningEffort: "high",
        },
        proxy: {
          host: "0.0.0.0",
          port: 5000,
          allowedModels: ["custom-model"],
        },
      }),
      "utf8",
    );

    const env = {
      CLAUDE_CODE_CODEX_CONFIG: configPath,
      ANTHROPIC_AUTH_TOKEN: "secret",
    } as NodeJS.ProcessEnv;

    const config = await loadConfig(env);

    expect(config.baseUrl).toBe("https://override.test");
    expect(config.defaults.reasoningEffort).toBe("high");
    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(5000);
    expect(config.allowedModels).toEqual(["custom-model"]);
    expect(config.authToken).toBe("secret");
  });
});
