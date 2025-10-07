import { Readable } from "stream";
import type { ReadableStream as NodeReadableStream } from "stream/web";

export interface SseChunk {
  event?: string;
  data?: string;
}

type FetchResponse = globalThis.Response;

enum ContentType {
  Json = "application/json",
  EventStream = "text/event-stream",
}

export async function parseSseStream(buffer: string): Promise<SseChunk[]> {
  const events: SseChunk[] = [];
  for (const block of buffer.split(/\n\n+/)) {
    const trimmed = block.trim();
    if (!trimmed) {
      continue;
    }
    const lines = trimmed.split(/\n/);
    const chunk: SseChunk = {};
    for (const line of lines) {
      const [rawKey, ...rest] = line.split(":");
      if (!rawKey) {
        continue;
      }
      const key = rawKey.trim();
      const value = rest.join(":").trim();
      if (key === "event") {
        chunk.event = value;
      } else if (key === "data") {
        chunk.data = chunk.data ? `${chunk.data}\n${value}` : value;
      }
    }
    if (Object.keys(chunk).length > 0) {
      events.push(chunk);
    }
  }
  return events;
}

export async function responseToJson(response: FetchResponse): Promise<unknown> {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes(ContentType.Json)) {
    return response.json();
  }
  if (contentType.includes(ContentType.EventStream)) {
    const text = await response.text();
    return parseSseStream(text);
  }
  return response.text();
}

export function toAsyncIterable(response: FetchResponse): AsyncIterable<string> {
  const body = response.body;
  if (!body) {
    return (async function* empty() {})();
  }
  if (Symbol.asyncIterator in body) {
    return body as unknown as AsyncIterable<string>;
  }
  const readable = Readable.fromWeb(body as unknown as NodeReadableStream<Uint8Array>);
  return readable.setEncoding("utf8");
}

export function headersToObject(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });
  return result;
}
