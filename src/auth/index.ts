import crypto from "crypto";
import { CodexConfig, CodexTokenSet, Logger } from "../types";
import { TokenStore, isExpired } from "./token-store";
import { AuthorizationDetails, buildAuthorizationDetails, exchangeCodeForToken, refreshAccessToken } from "./oauth";
import { waitForOAuthCallback } from "./server";
import { openBrowser } from "./browser";

export class AuthManager {
  private readonly store: TokenStore;

  constructor(private readonly config: CodexConfig, private readonly logger: Logger) {
    this.store = new TokenStore(config.authPath);
  }

  async getToken(): Promise<CodexTokenSet> {
    const existing = await this.store.read();
    if (existing && !isExpired(existing)) {
      this.logger.debug("Using cached OAuth token", {
        expiresAt: existing.expiresAt,
        accountId: existing.accountId,
      });
      return existing;
    }

    if (existing && existing.refreshToken) {
      try {
        const refreshed = await this.refresh(existing.refreshToken);
        await this.store.write(refreshed);
        this.logger.info("Refreshed Codex OAuth token", { accountId: refreshed.accountId });
        return refreshed;
      } catch (error) {
        this.logger.warn("Failed to refresh Codex token; falling back to interactive flow", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const token = await this.interactiveFlow();
    await this.store.write(token);
    return token;
  }

  private async refresh(refreshToken: string): Promise<CodexTokenSet> {
    const token = await refreshAccessToken(this.config, refreshToken);
    if (!token.accountId && this.config.accountId) {
      token.accountId = this.config.accountId;
    }
    return token;
  }

  private async interactiveFlow(): Promise<CodexTokenSet> {
    const auth = buildAuthorizationDetails(this.config);
    this.logger.info("Starting Codex OAuth flow", { redirect: this.config.oauth.redirectUri });
    await openBrowser(auth.authorizationUrl);
    const { code } = await waitForOAuthCallback(auth.state);
    const token = await exchangeCodeForToken(this.config, code, auth.pkce);
    if (!token.accountId && this.config.accountId) {
      token.accountId = this.config.accountId;
    }
    return token;
  }

  getAuthorizationDetails(): AuthorizationDetails {
    return buildAuthorizationDetails(this.config);
  }

  createSessionId(): string {
    return crypto.randomUUID();
  }
}
