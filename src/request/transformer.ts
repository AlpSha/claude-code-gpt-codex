import { CodexConfig } from "../types";
import { CLAUDE_BRIDGE_PROMPT } from "../prompts/claude-bridge";

export interface TransformOptions {
  injectPrompt?: boolean;
  bridgePrompt?: string;
}

export interface TransformResult {
  body: Record<string, unknown>;
  injectedBridgePrompt: boolean;
}

const STATELESS_PREFIX = "rs_";

function deepClone<T>(input: T): T {
  return JSON.parse(JSON.stringify(input)) as T;
}

function stripStatelessArtifacts(payload: Record<string, unknown>) {
  for (const key of Object.keys(payload)) {
    if (key.startsWith(STATELESS_PREFIX)) {
      delete payload[key];
      continue;
    }
    const value = payload[key];
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (typeof item === "object" && item !== null) {
          stripStatelessArtifacts(item as Record<string, unknown>);
        }
      });
    } else if (typeof value === "object" && value !== null) {
      stripStatelessArtifacts(value as Record<string, unknown>);
    }
  }
}

function normalizeModelId(requestBody: Record<string, unknown>) {
  const raw = (requestBody.model as string | undefined)?.toLowerCase() ?? "";
  if (!raw) {
    requestBody.model = "gpt-5-codex";
    return;
  }
  if (raw === "gpt-5" || raw === "gpt-5-codex") {
    requestBody.model = "gpt-5-codex";
    return;
  }
  if (!raw.includes("codex")) {
    requestBody.model = "gpt-5-codex";
  }
}

function mergeReasoningDefaults(config: CodexConfig, requestBody: Record<string, unknown>) {
  const existing = (requestBody.reasoning ?? {}) as Record<string, unknown>;
  requestBody.reasoning = {
    effort: existing.effort ?? config.defaults.reasoningEffort,
    summary: existing.summary ?? config.defaults.reasoningSummary,
    include: existing.include ?? config.defaults.include,
  };

  const text = (requestBody.text ?? {}) as Record<string, unknown>;
  requestBody.text = {
    verbosity: text.verbosity ?? config.defaults.textVerbosity,
    ...text,
  };

  if (!Array.isArray(requestBody.include)) {
    requestBody.include = config.defaults.include;
  }
}

function hasTools(requestBody: Record<string, unknown>): boolean {
  const tools = requestBody.tools;
  if (Array.isArray(tools)) {
    return tools.length > 0;
  }
  if (tools && typeof tools === "object") {
    return Object.keys(tools).length > 0;
  }
  return false;
}

function dedupeBridgePrompt(messages: unknown[], bridge: string): unknown[] {
  const serialBridge = JSON.stringify({ role: "developer", content: bridge });
  const seen = new Set<string>();
  const filtered: unknown[] = [];
  for (const message of messages) {
    const snapshot = JSON.stringify(message);
    if (snapshot === serialBridge) {
      continue;
    }
    if (!seen.has(snapshot)) {
      seen.add(snapshot);
      filtered.push(message);
    }
  }
  return filtered;
}

function injectBridgePrompt(
  requestBody: Record<string, unknown>,
  prompt: string,
): { applied: boolean; body: Record<string, unknown> } {
  if (!Array.isArray(requestBody.messages)) {
    requestBody.messages = [];
  }
  const messages = requestBody.messages as unknown[];
  const cleaned = dedupeBridgePrompt(messages, prompt);
  cleaned.unshift({ role: "developer", content: prompt });
  requestBody.messages = cleaned;
  return { applied: true, body: requestBody };
}

export function shouldInjectPrompt(config: CodexConfig, requestBody: Record<string, unknown>): boolean {
  if (config.promptInjectionStrategy === "disabled") {
    return false;
  }
  if (config.promptInjectionStrategy === "force") {
    return true;
  }
  return hasTools(requestBody);
}

export function transformRequest(
  config: CodexConfig,
  originalBody: Record<string, unknown>,
  options: TransformOptions = {},
): TransformResult {
  const body = deepClone(originalBody);
  stripStatelessArtifacts(body);
  normalizeModelId(body);
  mergeReasoningDefaults(config, body);

  let injected = false;
  if (options.injectPrompt ?? shouldInjectPrompt(config, body)) {
    const prompt = options.bridgePrompt ?? CLAUDE_BRIDGE_PROMPT;
    const result = injectBridgePrompt(body, prompt);
    injected = result.applied;
  }

  const messages = Array.isArray(body.messages) ? (body.messages as Array<Record<string, unknown>>) : [];
  body.input = convertMessagesToInput(messages);
  delete body.messages;

  body.store = false;
  body.stream = true;
  if (body.max_output_tokens === undefined) {
    body.max_output_tokens = null;
  }
  if (body.max_completion_tokens === undefined) {
    body.max_completion_tokens = null;
  }

  return {
    body,
    injectedBridgePrompt: injected,
  };
}

function convertMessagesToInput(messages: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") {
      continue;
    }
    const role = typeof message.role === "string" ? message.role : "user";
    const content = normalizeMessageContent(message.content);
    input.push({
      type: "message",
      role,
      content,
    });
  }
  return input;
}

function normalizeMessageContent(content: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(content)) {
    const blocks: Array<Record<string, unknown>> = [];
    for (const block of content) {
      if (!block || typeof block !== "object") {
        continue;
      }
      const typed = block as { type?: unknown; text?: unknown };
      if (typed.type === "input_text" && typeof typed.text === "string") {
        blocks.push({ type: "input_text", text: typed.text });
      } else if (typed.type === "text" && typeof typed.text === "string") {
        blocks.push({ type: "input_text", text: typed.text });
      }
    }
    if (blocks.length > 0) {
      return blocks;
    }
  }

  if (typeof content === "string") {
    return [{ type: "input_text", text: content }];
  }

  return [{ type: "input_text", text: "" }];
}
