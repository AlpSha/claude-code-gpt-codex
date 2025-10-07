# Anthropic-Compatible Proxy Implementation

This document explains how the repository delivers an Anthropic-compatible proxy that reuses the Codex (ChatGPT) client stack. The proxy allows Claude Code to forward Anthropic `/v1/messages` and `/v1/complete` calls to OpenAI's Codex pipeline while preserving the existing OAuth, request transformation, and streaming helpers.

## High-Level Architecture
```
Claude Code ──(Anthropic JSON/SSE)──> Fastify Proxy ──(Claude request)──> CodexFetchPipeline ──> OpenAI Codex
```

### Core Modules
- `src/index.ts` – CLI entry point that loads configuration, prepares dependencies, and starts the Fastify server.
- `src/server/app.ts` – builds the Fastify instance, wires shared error handling, and registers proxy routes.
- `src/server/routes/messages.ts` – implements `POST /v1/messages`, including streaming support via `pipeCodexStreamToAnthropic`.
- `src/server/routes/complete.ts` – implements `POST /v1/complete` by wrapping prompts into Anthropic message payloads.
- `src/server/auth.ts` – validates `Authorization: Bearer <ANTHROPIC_AUTH_TOKEN>` or `x-api-key` headers before requests hit the pipeline.
- `src/proxy/anthropic-adapter.ts` – pure adapters that translate Anthropic request/response shapes into Codex-friendly equivalents and vice versa.
- `src/request/` – unchanged Codex fetch pipeline (OAuth refresh, header injection, SSE helpers, logging).

## Request Lifecycle (`/v1/messages`)
1. **Authentication** – `createAuthPreHandler` checks the provided bearer token against `config.authToken`. Missing or mismatched credentials short-circuit with Anthropic-style error payloads.
2. **Validation** – handlers ensure the request body contains the minimal Anthropic schema (`messages` array for `/v1/messages`, `prompt` string for `/v1/complete`).
3. **Streaming Detection** – the proxy sets `stream = body.stream ?? Accept.includes("text/event-stream")` to align with Anthropic clients.
4. **Request Adaptation** – `buildClaudeRequest` converts Anthropic payloads into Claude/Codex requests:
   - Normalises models (`gpt-5` → `gpt-5-codex`) while respecting `config.allowedModels`.
   - Flattens message content, maps `system` → `instructions`, carries metadata, tool definitions, and `max_tokens` → `max_output_tokens`.
   - Forwards Anthropic headers (`anthropic-version`, `anthropic-beta`, etc.) alongside pipeline-injected Codex headers.
5. **Pipeline Execution** – `CodexFetchPipeline.handle` performs OAuth refresh, bridge prompt injection (if enabled), header injection, and dispatches the Codex request.
6. **Response Adaptation** –
   - JSON responses: `codexResponseToAnthropic` emits Anthropic `message` payloads (`message_start`, `content` blocks, usage, stop reason).
   - Streaming responses: `pipeCodexStreamToAnthropic` rewrites Codex SSE events into Anthropic-compatible event names and terminates with `data: [DONE]\n\n`.
7. **Error Mapping** – all thrown errors are converted into Anthropic error payloads via `toAnthropicError`, preserving status codes when available.

## `/v1/complete`
The `/v1/complete` route mirrors `/v1/messages`. `buildClaudeRequestFromPrompt` wraps the prompt into a single user message before invoking the shared pipeline. Non-streaming responses are converted back to Anthropic completion objects containing both the generated text (`completion`) and the original prompt.

## Configuration & Environment Variables
Configuration is loaded through `loadConfig`, merging defaults, optional JSON overrides, and environment variables.

| Variable | Purpose | Default |
| --- | --- | --- |
| `PROXY_HOST` | Bind address for the Fastify server | `127.0.0.1` |
| `PROXY_PORT` | Listening port for the proxy | `4000` |
| `ANTHROPIC_AUTH_TOKEN` | Shared secret expected in the `Authorization` header | *(required)* |
| `ANTHROPIC_ALLOWED_MODELS` | Comma-separated list of models exposed to Claude Code | `gpt-5-codex,gpt-5` |
| `CODEX_MODE` | Bridge prompt behaviour (`auto`, `force`, `disabled`, `1`, `0`) | `auto` |
| `CLAUDE_CODE_CODEX_BASE_URL` | Downstream Codex base URL | `https://chatgpt.com/backend-api` |
| `CLAUDE_CODE_CODEX_CACHE_DIR` | Cache directory (`claude-tooling-bridge.txt`, etc.) | `~/.claude-code/cache` |
| `CLAUDE_CODE_CODEX_AUTH_PATH` | Token store location | `~/.claude-code/auth/codex.json` |
| `CLAUDE_CODE_CODEX_DEBUG` | Verbose logging toggle (`1`/`0`) | `0` |
| `CLAUDE_CODE_CODEX_CONFIG` | Path to JSON overrides | *(unset)* |

> Claude Code itself should be configured with `ANTHROPIC_BASE_URL=http://<host>:<port>`, `ANTHROPIC_AUTH_TOKEN=<shared secret>`, and `ANTHROPIC_MODEL=gpt-5-codex` (or another value found in `ANTHROPIC_ALLOWED_MODELS`).

## Running the Proxy Locally
```
bun install
bun run build
PROXY_PORT=4000 ANTHROPIC_AUTH_TOKEN=secret bun node dist/index.js
```
The CLI entry validates `ANTHROPIC_AUTH_TOKEN`, ensures the bridge prompt cache exists, initialises the OAuth manager, and starts the Fastify server. Logs are emitted through `createLogger` when debugging is enabled.

## Smoke Test with Claude Code
1. Start the proxy (see above).
2. In Claude Code, set environment variables:
   - `ANTHROPIC_BASE_URL=http://localhost:4000`
   - `ANTHROPIC_AUTH_TOKEN=secret`
   - `ANTHROPIC_MODEL=gpt-5-codex`
3. Trigger a Claude Code session and send a simple prompt ("Say hello").
4. Observe proxy logs for request/response traces (enable `CLAUDE_CODE_CODEX_DEBUG=1` if deeper inspection is needed).
5. Execute a tool-enabled prompt to validate bridge prompt injection and tool routing.

## Prompt Injection Toggle
`transformRequest` honours `CODEX_MODE` or explicit overrides in the JSON config. When `auto`, the bridge prompt is injected only when tools are present. Setting `CODEX_MODE=force` always injects, while `CODEX_MODE=disabled` prevents injection entirely. The cached prompt content lives in `config.bridgePromptCachePath`.

## Development Workflow
- `bun run test` – executes the Vitest suites, including adapter, server, auth, and transformer tests.
- `bun run typecheck` – validates TypeScript types without emitting output.
- `bun run build` – produces the runnable `dist/` bundle used by the CLI entry point.

See `docs/PROMPTS.md` for detailed bridge prompt context and caching behaviour.
