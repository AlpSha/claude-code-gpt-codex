import { CodexTokenSet } from "../types";
import { fileExists, readJsonFile, writeJsonFile } from "../utils/fs";

const TOKEN_SCHEMA_VERSION = 1;

interface PersistedTokenShape {
  version: number;
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
}

export class TokenStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<CodexTokenSet | null> {
    const exists = await fileExists(this.filePath);
    if (!exists) {
      return null;
    }

    const persisted = await readJsonFile<PersistedTokenShape>(this.filePath);
    if (!persisted) {
      return null;
    }
    if (persisted.version !== TOKEN_SCHEMA_VERSION) {
      return null;
    }

    return {
      accessToken: persisted.access,
      refreshToken: persisted.refresh,
      expiresAt: persisted.expires,
      accountId: persisted.accountId,
    };
  }

  async write(token: CodexTokenSet): Promise<void> {
    const payload: PersistedTokenShape = {
      version: TOKEN_SCHEMA_VERSION,
      access: token.accessToken,
      refresh: token.refreshToken,
      expires: token.expiresAt,
      accountId: token.accountId,
    };
    await writeJsonFile(this.filePath, payload);
  }

  async clear(): Promise<void> {
    await writeJsonFile(this.filePath, {
      version: TOKEN_SCHEMA_VERSION,
      access: "",
      refresh: "",
      expires: 0,
    });
  }
}

export function isExpired(token: CodexTokenSet, skewMs = 60_000): boolean {
  return token.expiresAt <= Date.now() + skewMs;
}
