import type { FastifyReply, FastifyRequest } from "fastify";
import type { CodexConfig, ClaudeModelRequest, ClaudeModelResponse, Logger } from "../types";
import type { CodexFetchPipeline } from "../request/fetch";

export interface ProxyConfig extends CodexConfig {
  host: string;
  port: number;
  authToken: string;
  allowedModels: string[];
}

export type AnthropicRole = "user" | "assistant" | "system" | "tool";

export interface AnthropicTextBlock {
  type: "text";
  text: string;
}

export interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

export type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

export interface AnthropicMessage {
  role: AnthropicRole;
  content: string | AnthropicContentBlock[];
}

export type AnthropicSystemItem =
  | string
  | {
      type?: string;
      text?: string;
      content?: unknown;
      [key: string]: unknown;
    };

export type AnthropicSystemValue = AnthropicSystemItem | AnthropicSystemItem[];

export interface AnthropicMetadata {
  user_id?: string;
  [key: string]: unknown;
}

export interface AnthropicToolDefinition {
  name: string;
  description?: string;
  input_schema?: unknown;
}

export interface AnthropicToolChoice {
  type: "auto" | "tool" | "none";
  name?: string;
}

export interface MessagesPayload {
  model?: string;
  messages: AnthropicMessage[];
  system?: AnthropicSystemValue;
  metadata?: AnthropicMetadata;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  max_tokens?: number;
  stop_sequences?: string[];
  tools?: AnthropicToolDefinition[];
  tool_choice?: AnthropicToolChoice | "auto" | "none";
  [key: string]: unknown;
}

export interface CompletePayload {
  model?: string;
  prompt: string;
  stream?: boolean;
  max_tokens?: number;
  stop_sequences?: string[];
  temperature?: number;
  top_p?: number;
  top_k?: number;
  metadata?: AnthropicMetadata;
  [key: string]: unknown;
}

export interface ProxyResponse {
  status: number;
  body: unknown;
}

export interface ServerDeps {
  config: ProxyConfig;
  logger: Logger;
  pipeline: CodexFetchPipeline;
}

export type FastifyHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface AnthropicErrorPayload {
  type: "error";
  error: {
    type: string;
    message: string;
    status?: number;
    [key: string]: unknown;
  };
}

export interface AnthropicMessageResponse {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  stop_reason?: string | null;
  stop_sequence?: string | null;
  usage?: Record<string, unknown>;
  content: AnthropicContentBlock[];
  [key: string]: unknown;
}

export interface StreamEmitContext {
  model: string;
  messageId: string;
}

export interface BuildClaudeRequestOptions {
  config: ProxyConfig;
  headers: Record<string, string | undefined>;
  stream: boolean;
  bridgePromptOverride?: boolean;
}

export interface ClaudeRequestBuilder {
  build: (payload: MessagesPayload, options: BuildClaudeRequestOptions) => ClaudeModelRequest;
  buildFromPrompt: (
    payload: CompletePayload,
    options: BuildClaudeRequestOptions,
  ) => { request: ClaudeModelRequest; original: MessagesPayload };
}

export interface CodexResponseAdapter {
  toAnthropic: (response: ClaudeModelResponse) => AnthropicMessageResponse;
}
