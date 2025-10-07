import crypto from "crypto";
import path from "path";
import { promises as fs } from "fs";
import { ensureDir } from "./fs";
import type { ProxyConfig } from "../server/types";

interface LogEntry {
  type: "messages" | "complete";
  body: unknown;
  headers: Record<string, unknown>;
  query?: Record<string, unknown>;
}

export async function logProxyRequest(config: ProxyConfig, entry: LogEntry): Promise<void> {
  const dir = path.join(config.cacheDir, "request-logs");
  await ensureDir(dir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const id = crypto.randomUUID();
  const filePath = path.join(dir, `${timestamp}-${entry.type}-${id}.json`);

  const payload = {
    timestamp: new Date().toISOString(),
    type: entry.type,
    headers: entry.headers,
    query: entry.query,
    body: entry.body,
  };

  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
}
