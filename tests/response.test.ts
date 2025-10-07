import { describe, expect, it } from "vitest";
import { parseSseStream, headersToObject } from "../src/request/response";

describe("parseSseStream", () => {
  it("parses SSE data blocks", async () => {
    const sse = "data: {\"foo\":1}\n\n";
    const events = await parseSseStream(sse);
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('{"foo":1}');
  });
});

describe("headersToObject", () => {
  it("normalises header casing", () => {
    const headers = new Headers();
    headers.append("Content-Type", "application/json");
    const object = headersToObject(headers);
    expect(object["content-type"]).toBe("application/json");
  });
});
