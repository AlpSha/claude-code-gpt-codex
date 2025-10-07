import { describe, expect, it } from "vitest";
import { extractAccountId, generatePkcePair } from "../src/auth/oauth";

describe("extractAccountId", () => {
  it("returns account id from JWT payload", () => {
    const payload = { sub: "acct_123", aud: "example" };
    const token = [
      Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
      Buffer.from(JSON.stringify(payload)).toString("base64url"),
      "",
    ].join(".");

    expect(extractAccountId(token)).toBe("acct_123");
  });

  it("returns undefined for invalid tokens", () => {
    expect(extractAccountId("not-a-token")).toBeUndefined();
  });
});

describe("generatePkcePair", () => {
  it("generates verifier and challenge", () => {
    const pkce = generatePkcePair();

    expect(pkce.codeVerifier).toBeTruthy();
    expect(pkce.codeChallenge).toBeTruthy();
    expect(pkce.method).toBe("S256");
    expect(pkce.codeVerifier).not.toEqual(pkce.codeChallenge);
  });
});
