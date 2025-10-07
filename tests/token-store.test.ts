import { describe, expect, it } from "vitest";
import { TokenStore, isExpired } from "../src/auth/token-store";
import { mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";

const sampleToken = {
  accessToken: "access",
  refreshToken: "refresh",
  expiresAt: Date.now() + 3600_000,
};

describe("TokenStore", () => {
  it("reads and writes token data", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "codex-token-"));
    const file = path.join(dir, "token.json");
    const store = new TokenStore(file);

    await store.write(sampleToken);
    const loaded = await store.read();

    expect(loaded?.accessToken).toBe("access");
    expect(loaded?.refreshToken).toBe("refresh");

    await rm(dir, { recursive: true, force: true });
  });
});

describe("isExpired", () => {
  it("detects expired tokens with skew", () => {
    const token = { ...sampleToken, expiresAt: Date.now() - 1000 };
    expect(isExpired(token)).toBe(true);
  });

  it("respects skew", () => {
    const token = { ...sampleToken, expiresAt: Date.now() + 10_000 };
    expect(isExpired(token, 0)).toBe(false);
  });
});
