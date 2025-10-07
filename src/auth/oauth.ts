import crypto from "crypto";
import { URL, URLSearchParams } from "url";
import { CodexConfig, CodexTokenSet } from "../types";
import { maskToken } from "../utils/logger";

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
  method: "S256";
}

export interface AuthorizationDetails {
  authorizationUrl: string;
  state: string;
  pkce: PkcePair;
}

interface TokenEndpointResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export function generatePkcePair(): PkcePair {
  const codeVerifier = base64UrlEncode(crypto.randomBytes(32));
  const challenge = base64UrlEncode(crypto.createHash("sha256").update(codeVerifier).digest());
  return {
    codeVerifier,
    codeChallenge: challenge,
    method: "S256",
  };
}

export function buildAuthorizationDetails(config: CodexConfig): AuthorizationDetails {
  const state = base64UrlEncode(crypto.randomBytes(18));
  const pkce = generatePkcePair();
  const url = new URL(config.oauth.authorizeUrl);
  url.searchParams.set("client_id", config.oauth.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.oauth.redirectUri);
  url.searchParams.set("scope", config.oauth.scope);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", pkce.codeChallenge);
  url.searchParams.set("code_challenge_method", pkce.method);

  return {
    authorizationUrl: url.toString(),
    state,
    pkce,
  };
}

function parseTokenResponse(payload: TokenEndpointResponse): CodexTokenSet {
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
  };
}

async function requestToken(url: string, body: URLSearchParams): Promise<TokenEndpointResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token endpoint returned ${response.status}: ${text}`);
  }

  return (await response.json()) as TokenEndpointResponse;
}

export async function exchangeCodeForToken(
  config: CodexConfig,
  code: string,
  pkce: PkcePair,
): Promise<CodexTokenSet> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.oauth.redirectUri,
    code_verifier: pkce.codeVerifier,
    client_id: config.oauth.clientId,
  });

  const payload = await requestToken(config.oauth.tokenUrl, params);
  const tokenSet = parseTokenResponse(payload);
  tokenSet.accountId = extractAccountId(tokenSet.accessToken);
  return tokenSet;
}

export async function refreshAccessToken(
  config: CodexConfig,
  refreshToken: string,
): Promise<CodexTokenSet> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.oauth.clientId,
  });

  const payload = await requestToken(config.oauth.tokenUrl, params);
  const tokenSet = parseTokenResponse(payload);
  tokenSet.accountId = extractAccountId(tokenSet.accessToken);
  return tokenSet;
}

export function extractAccountId(accessToken: string): string | undefined {
  const parts = accessToken.split(".");
  if (parts.length < 2) {
    return undefined;
  }
  try {
    const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson) as { sub?: string; user_id?: string };
    return payload.sub || payload.user_id;
  } catch (error) {
    console.warn(`Failed to decode access token: ${maskToken(accessToken)}`, { error });
    return undefined;
  }
}
