import { parseSseStream } from "../request/response";
import type { ClaudeModelRequest, ClaudeModelResponse } from "../types";
import {
  type AnthropicContentBlock,
  type AnthropicMessage,
  type AnthropicMessageResponse,
  type AnthropicToolDefinition,
  type BuildClaudeRequestOptions,
  type CompletePayload,
  type MessagesPayload,
  type ProxyConfig,
  type StreamEmitContext,
} from "../server/types";

const CLAUDE_ENDPOINT = "/responses";

export function buildClaudeRequest(payload: MessagesPayload, options: BuildClaudeRequestOptions): ClaudeModelRequest {
  const model = normalizeModel(payload.model, options.config);
  const headers = buildForwardHeaders(payload, options);
  const body = buildRequestBody(payload, model, options.stream ?? false);

  return {
    url: `${options.config.baseUrl.replace(/\/$/, "")}${CLAUDE_ENDPOINT}`,
    method: "POST",
    headers,
    body,
    stream: options.stream,
    bridgePromptOverride: options.bridgePromptOverride,
  };
}

export function buildClaudeRequestFromPrompt(
  payload: CompletePayload,
  options: BuildClaudeRequestOptions,
): { request: ClaudeModelRequest; original: MessagesPayload } {
  const messagesPayload: MessagesPayload = {
    model: payload.model,
    messages: [
      {
        role: "user",
        content: payload.prompt,
      },
    ],
    max_tokens: payload.max_tokens,
    stop_sequences: payload.stop_sequences,
    temperature: payload.temperature,
    top_p: payload.top_p,
    top_k: payload.top_k,
    stream: payload.stream,
    metadata: payload.metadata,
  };

  const request = buildClaudeRequest(messagesPayload, options);
  return { request, original: messagesPayload };
}

export function codexResponseToAnthropic(response: ClaudeModelResponse, config: ProxyConfig): AnthropicMessageResponse {
  const body = response.body as Record<string, unknown> | undefined;
  const id = typeof body?.id === "string" ? body.id : `msg_${Date.now()}`;
  const model = typeof body?.model === "string" ? body.model : config.allowedModels[0] || "gpt-5-codex";
  const stopReason = getStopReason(body);
  const stopSequence = getStopSequence(body);
  const usage = extractUsage(body);
  const content = extractContentBlocks(body);

  return {
    id,
    type: "message",
    role: "assistant",
    model,
    stop_reason: stopReason,
    stop_sequence: stopSequence,
    usage,
    content: content.length > 0 ? content : [{ type: "text", text: "" }],
    provider: {
      type: "proxy",
      name: "codex-gpt-5",
    },
  };
}

export async function pipeCodexStreamToAnthropic(
  stream: AsyncIterable<string>,
  write: (chunk: string) => void,
): Promise<void> {
  let buffer = "";
  let context: StreamEmitContext | undefined;
  let contentStarted = false;
  let contentStopped = false;
  let completed = false;
  let lastUsage: Record<string, unknown> | undefined;
  let lastStopReason: string | null = null;
  let accumulatedText = "";

  for await (const chunk of stream) {
    buffer += chunk;
    const segments = buffer.split(/\n\n/);
    buffer = segments.pop() ?? "";
    for (const segment of segments) {
      await processSegment(`${segment}\n\n`, write, (ctx) => {
        context = ctx ?? context;
      }, () => {
        if (!contentStarted) {
          write(
            `data: ${JSON.stringify({
              type: "content_block_start",
              index: 0,
              content_block: { type: "text", text: "" },
            })}\n\n`,
          );
          contentStarted = true;
        }
      },
      (delta) => {
        accumulatedText += delta;
      },
      () => {
        contentStopped = true;
      },
      (usage, stopReason) => {
        completed = true;
        lastUsage = usage ?? lastUsage;
        lastStopReason = stopReason ?? lastStopReason;
      });
    }
  }

  if (buffer.trim().length > 0) {
    await processSegment(`${buffer}\n\n`, write, (ctx) => {
      context = ctx ?? context;
    }, () => {
      if (!contentStarted) {
        write(
          `data: ${JSON.stringify({
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" },
          })}\n\n`,
        );
        contentStarted = true;
      }
    },
    (delta) => {
      accumulatedText += delta;
    },
    () => {
      contentStopped = true;
    },
    (usage, stopReason) => {
      completed = true;
      lastUsage = usage ?? lastUsage;
      lastStopReason = stopReason ?? lastStopReason;
    });
  }

  if (context) {
    if (contentStarted && !contentStopped) {
      write(
        `data: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
      );
    }
    if (!completed) {
      write(
        `data: ${JSON.stringify({ type: "message_delta", usage: lastUsage ?? {} })}\n\n`,
      );
      write(
        `data: ${JSON.stringify({
          type: "message_stop",
          stop_reason: lastStopReason ?? "end_turn",
          stop_sequence: null,
        })}\n\n`,
      );
    }
    write(
      `data: ${JSON.stringify({
        type: "message_end",
        message: {
          id: context.messageId,
          role: "assistant",
          model: context.model,
          content: [{ type: "text", text: accumulatedText }],
        },
      })}\n\n`,
    );
  }
  write("data: [DONE]\n\n");
}

async function processSegment(
  segment: string,
  write: (chunk: string) => void,
  updateContext: (context?: StreamEmitContext) => void,
  ensureContentStarted: () => void,
  appendText: (delta: string) => void,
  markContentStopped: () => void,
  markCompleted: (usage?: Record<string, unknown>, stopReason?: string | null) => void,
): Promise<void> {
  const events = await parseSseStream(segment);
  for (const event of events) {
    if (!event.data) {
      continue;
    }
    handleEvent(event.event, event.data, write, updateContext, ensureContentStarted, appendText, markContentStopped, markCompleted);
  }
}

function handleEvent(
  eventName: string | undefined,
  rawData: string,
  write: (chunk: string) => void,
  updateContext: (context?: StreamEmitContext) => void,
  ensureContentStarted: () => void,
  appendText: (delta: string) => void,
  markContentStopped: () => void,
  markCompleted: (usage?: Record<string, unknown>, stopReason?: string | null) => void,
): void {
  if (!eventName) {
    if (rawData.trim() === "[DONE]") {
      write("data: [DONE]\n\n");
    }
    return;
  }

  try {
    const payload = JSON.parse(rawData) as Record<string, unknown>;
    switch (eventName) {
      case "response.created": {
        const id = typeof payload.id === "string" ? payload.id : `msg_${Date.now()}`;
        const model = typeof payload.model === "string" ? payload.model : "gpt-5-codex";
        updateContext({ messageId: id, model });
        write(
          `data: ${JSON.stringify({
            type: "message_start",
            message: {
              id,
              role: "assistant",
              model,
            },
          })}\n\n`,
        );
        break;
      }
      case "response.output_text.delta": {
        const delta = getDeltaText(payload);
        if (!delta) {
          break;
        }
        ensureContentStarted();
        appendText(delta);
        write(
          `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: delta } })}\n\n`,
        );
        break;
      }
      case "response.output_text.done": {
        ensureContentStarted();
        write(
          `data: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
        );
        markContentStopped();
        break;
      }
      case "response.completed": {
        const usage = (extractUsage(payload.response as Record<string, unknown>) ?? payload.usage ?? {}) as Record<
          string,
          unknown
        >;
        const stopReason = typeof payload.stop_reason === "string" ? payload.stop_reason : "end_turn";
        write(
          `data: ${JSON.stringify({ type: "message_delta", usage })}\n\n`,
        );
        write(
          `data: ${JSON.stringify({ type: "message_stop", stop_reason: stopReason, stop_sequence: null })}\n\n`,
        );
        markCompleted(usage as Record<string, unknown>, stopReason);
        break;
      }
      case "ping": {
        write(": keep-alive\n\n");
        break;
      }
      default:
        break;
    }
  } catch {
    // Ignore malformed JSON payloads
  }
}

function getDeltaText(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.delta === "string") {
    return payload.delta;
  }
  if (typeof payload.text === "string") {
    return payload.text;
  }
  if (payload.delta && typeof payload.delta === "object") {
    const maybe = payload.delta as { text?: unknown };
    if (typeof maybe.text === "string") {
      return maybe.text;
    }
  }
  return undefined;
}

const MODEL_ALIASES: Record<string, string> = {
  "gpt-5": "gpt-5-codex",
};

function normalizeModel(model: string | undefined, config: ProxyConfig): string {
  const allowedMap = new Map(
    (config.allowedModels ?? []).map((allowed) => [allowed.toLowerCase(), allowed] as const),
  );

  if (model) {
    const normalized = model.trim().toLowerCase();
    const aliasTarget = MODEL_ALIASES[normalized];
    if (aliasTarget) {
      const aliasMatch = allowedMap.get(aliasTarget.toLowerCase());
      if (aliasMatch) {
        return aliasMatch;
      }
      return aliasTarget;
    }

    const directMatch = allowedMap.get(normalized);
    if (directMatch) {
      return directMatch;
    }
  }

  return config.allowedModels[0] ?? "gpt-5-codex";
}

const DISALLOWED_FORWARD_HEADERS = new Set([
  "accept-encoding",
  "authorization",
  "connection",
  "content-length",
  "content-type",
  "host",
  "keep-alive",
  "proxy-connection",
  "te",
  "transfer-encoding",
  "trailer",
  "upgrade",
]);

function buildForwardHeaders(payload: MessagesPayload, options: BuildClaudeRequestOptions): Record<string, string> {
  const headers: Record<string, string> = {};
  const { headers: incoming } = options;
  for (const [key, value] of Object.entries(incoming)) {
    if (typeof value === "string") {
      const normalized = key.toLowerCase();
      if (DISALLOWED_FORWARD_HEADERS.has(normalized)) {
        continue;
      }
      headers[key] = value;
    }
  }
  if (payload.metadata?.user_id) {
    headers["user_id"] = payload.metadata.user_id;
  }
  return headers;
}

function buildRequestBody(payload: MessagesPayload, model: string, stream: boolean): Record<string, unknown> {
  const rawMessages = Array.isArray(payload.messages) ? payload.messages : [];
  const body: Record<string, unknown> = {
    model,
    messages: rawMessages.map(convertMessage),
    stream,
  };

  if (payload.system) {
    body.instructions = Array.isArray(payload.system) ? payload.system.join("\n") : payload.system;
  }
  if (payload.temperature !== undefined) {
    body.temperature = payload.temperature;
  }
  if (payload.top_p !== undefined) {
    body.top_p = payload.top_p;
  }
  if (payload.top_k !== undefined) {
    body.top_k = payload.top_k;
  }
  if (payload.max_tokens !== undefined) {
    body.max_output_tokens = payload.max_tokens;
  }
  if (payload.stop_sequences) {
    body.stop_sequences = payload.stop_sequences;
  }
  if (payload.tools) {
    body.tools = payload.tools.map(normalizeToolDefinition);
  }
  if (payload.tool_choice) {
    body.tool_choice = payload.tool_choice;
  }

  for (const [key, value] of Object.entries(payload)) {
    if (key in body) {
      continue;
    }
    if (SKIPPED_PAYLOAD_FIELDS.has(key)) {
      continue;
    }
    body[key] = value;
  }

  return body;
}

const SKIPPED_PAYLOAD_FIELDS = new Set([
  "messages",
  "system",
  "tools",
  "tool_choice",
  "metadata",
  "max_tokens",
  "stop_sequences",
  "temperature",
  "top_p",
  "top_k",
  "stream",
  "model",
]);

function convertMessage(message: AnthropicMessage): Record<string, unknown> {
  if (typeof message.content === "string") {
    return {
      role: message.role,
      content: message.content,
    };
  }

  const blocks = Array.isArray(message.content) ? message.content : [];
  const textSegments: string[] = [];
  for (const block of blocks) {
    if (block.type === "text") {
      textSegments.push(block.text);
    } else if (block.type === "tool_use") {
      textSegments.push(renderToolUse(block));
    } else if (block.type === "tool_result") {
      textSegments.push(renderToolResult(block));
    }
  }

  return {
    role: message.role,
    content: textSegments.join("\n"),
  };
}

function normalizeToolDefinition(tool: AnthropicToolDefinition): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? "",
      parameters: tool.input_schema ?? {},
    },
  };
}

function renderToolUse(block: AnthropicContentBlock): string {
  if (block.type !== "tool_use") {
    return "";
  }
  const input = block.input ? JSON.stringify(block.input) : "{}";
  return `[tool:${block.name}]${input}`;
}

function renderToolResult(block: AnthropicContentBlock): string {
  if (block.type !== "tool_result") {
    return "";
  }
  return `[tool_result:${block.tool_use_id}] ${block.content}`;
}

function extractUsage(body: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!body) {
    return undefined;
  }
  if (body.usage && typeof body.usage === "object") {
    return body.usage as Record<string, unknown>;
  }
  return undefined;
}

function extractContentBlocks(body: Record<string, unknown> | undefined): AnthropicContentBlock[] {
  if (!body) {
    return [];
  }

  const blocks: AnthropicContentBlock[] = [];
  const output = (body.output as unknown) ?? (body.responses as unknown);
  if (Array.isArray(output)) {
    for (const item of output) {
      if (item && typeof item === "object") {
        collectBlocksFromOutput(item as Record<string, unknown>, blocks);
      }
    }
  }

  if (!blocks.length) {
    const text = findTextFallback(body);
    if (text) {
      blocks.push({ type: "text", text });
    }
  }

  return blocks;
}

function collectBlocksFromOutput(output: Record<string, unknown>, blocks: AnthropicContentBlock[]): void {
  const content = output.content ?? output.output;
  if (typeof content === "string") {
    blocks.push({ type: "text", text: content });
    return;
  }
  if (!Array.isArray(content)) {
    return;
  }
  for (const item of content) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const block = item as { type?: string; text?: string; output_text?: string; name?: string; id?: string; arguments?: unknown };
    if (block.type === "output_text" || block.type === "text") {
      const text = block.text ?? (block as { output_text?: string }).output_text;
      if (typeof text === "string") {
        blocks.push({ type: "text", text });
      }
    } else if (block.type === "tool_call" || block.type === "tool_use") {
      const id = typeof block.id === "string" ? block.id : `tool_${blocks.length}`;
      const name = typeof block.name === "string" ? block.name : "tool";
      blocks.push({ type: "tool_use", id, name, input: block.arguments ?? {} });
    } else if (block.type === "tool_result") {
      const id = typeof block.id === "string" ? block.id : `tool_${blocks.length}`;
      const text = block.text ?? (block as { output_text?: string }).output_text;
      blocks.push({ type: "tool_result", tool_use_id: id, content: text ?? "" });
    }
  }
}

function findTextFallback(body: Record<string, unknown>): string | undefined {
  if (typeof body.output_text === "string") {
    return body.output_text;
  }
  if (Array.isArray(body.content)) {
    return body.content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string") {
          return (item as { text: string }).text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (typeof body.message === "string") {
    return body.message;
  }
  return undefined;
}

function getStopReason(body: Record<string, unknown> | undefined): string | null {
  if (!body) {
    return null;
  }
  if (typeof body.stop_reason === "string") {
    return body.stop_reason;
  }
  if (typeof body.status === "string") {
    return body.status;
  }
  return null;
}

function getStopSequence(body: Record<string, unknown> | undefined): string | null {
  if (!body) {
    return null;
  }
  if (typeof body.stop_sequence === "string") {
    return body.stop_sequence;
  }
  return null;
}
