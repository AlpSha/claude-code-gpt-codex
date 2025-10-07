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
      }),
      "utf8",
    );

    const env = {
      CLAUDE_CODE_CODEX_CONFIG: configPath,
    } as NodeJS.ProcessEnv;

    const config = await loadConfig(env);

    expect(config.baseUrl).toBe("https://override.test");
    expect(config.defaults.reasoningEffort).toBe("high");
  });
});
