# Anthropic-Compatible Proxy Migration

## Context
- The current codebase packages OAuth, request transformation, and Codex fetch logic as a Claude Code extension (`src/index.ts` exports `activate`).
- Claude Code no longer supports extensions but allows overriding its Anthropic endpoint via environment variables.
- We must stand up a local proxy that talks Anthropic's `/v1/messages` (and `/v1/complete` for parity) while reusing the existing Codex client stack (auth, transformers, SSE helpers, tests).

## Goals
- Preserve the 7-step Codex pipeline (auth/token refresh, request transform, header injection, SSE handling, logging, tests).
- Expose an HTTP server that accepts Anthropic-compatible requests and forwards them through the pipeline.
- Allow Claude Code to target the proxy via `ANTHROPIC_BASE_URL`, verify a shared secret in `ANTHROPIC_AUTH_TOKEN`, and surface model aliases via `ANTHROPIC_MODEL`.
- Keep token persistence in `~/.claude/auth/codex.json` and reuse existing config/env overrides where possible.
- Document setup so a Claude Code user can point at the proxy and run a smoke test.
- Optional: keep bridge prompt injection (default disabled) with an env toggle.

## Non-Goals
- Changing how OAuth works or where tokens are stored.
- Supporting OpenCode APIs—the proxy only needs `/v1/messages` and `/v1/complete`.
- Refactoring Codex transformation logic beyond light modularisation to power the proxy.

## High-Level Architecture
```
CLAUDE CODE ──(Anthropic JSON/SSE)──> Proxy (Fastify) ──(Claude request)──> CodexFetchPipeline ──> OpenAI Codex
```

### Key Components
- `src/config/index.ts` – continue to load Codex defaults; extend to read proxy-specific env vars (port, auth token, prompt toggle).
- `src/auth/`, `src/request/`, `src/utils/` – unchanged core clients.
- New `src/server/` module hierarchy:
  - `src/server/app.ts` – boot Fastify, register routes, wire dependencies (config, logger, AuthManager, CodexFetchPipeline).
  - `src/server/routes/messages.ts` – `POST /v1/messages` handler.
  - `src/server/routes/complete.ts` – `POST /v1/complete` alias that maps to the same pipeline.
  - `src/server/auth.ts` – middleware to validate `Authorization: Bearer <ANTHROPIC_AUTH_TOKEN>`.
  - `src/server/types.ts` – route payload DTOs mirroring Anthropic schemas to keep adapters testable.
- `src/proxy/anthropic-adapter.ts` – pure functions to translate Anthropic request/response payloads to the Claude/Codex schema and back.
- CLI entry point `src/index.ts` (new) exporting `startProxy()` and invoking it when run directly. Previous extension `activate` can move to `src/extension.ts` (kept only if needed by legacy tests; otherwise delete).

## Request Handling Flow (`POST /v1/messages`)
1. **Auth Check** – ensure `Authorization: Bearer <env.ANTHROPIC_AUTH_TOKEN>`; reject with 401 if missing/mismatch.
2. **Parse & Validate Body** – use Fastify schema or manual guards to ensure required Anthropic fields (`model`, `messages`, optional `system`, `tools`, `stream`, etc.).
3. **Determine Streaming** – set `stream = body.stream ?? request.headers.accept.includes("text/event-stream")`.
4. **Adapt Request** – call `buildClaudeRequest(body)` to produce a `ClaudeModelRequest`:
   - `url`: `${config.baseUrl}/responses` (pipeline rewrites it to `/codex/responses`).
   - `body`: convert Anthropic shape to existing transformer expectations: flatten message content to strings, map `system` → `instructions`, convert `tools` to Claude format, carry `metadata.tool_choice`, map `max_tokens` to `max_output_tokens`, etc.
   - `headers`: include Anthropics-sourced metadata (`anthropic-version`, `anthropic-beta`, `x-api-key` if provided), but rely on `buildHeaders` to stamp Codex auth/session values.
   - `stream`: computed flag.
5. **Send Through Pipeline** – reuse `CodexFetchPipeline.handle` (creates session, refreshes tokens, transforms request, fires fetch).
6. **Translate Response** – depending on pipeline output:
   - **JSON**: adapt to Anthropic `Message` schema; at minimum supply `id`, `type`, `role`, `content` (as text content block), `model`, `usage`, `stop_reason`.
   - **Stream**: wrap the AsyncIterable from `pipeline` and transform Codex SSE chunks to Anthropic event stream (`message_start`, `content_block_start`, `content_block_delta`, `message_end`). Use existing `parseSseStream` helper where helpful, but prefer streaming line-by-line (avoid buffering entire stream).
7. **Errors** – map Codex HTTP errors to Anthropic-style JSON error objects (`{type:"error", error:{type:"...", message:"..."}}`) and surface appropriate status codes.

## `/v1/complete`
- Optional compatibility endpoint; reuse the same handler but normalise Anthropic completion-style requests (single prompt string) into a `messages` array (`[{ role: "user", content: prompt }]`). Rely on the same adapter and return Anthropic completion schema (legacy `completion` field) or respond with a 501 if not worth implementing.

## Request/Response Adaptation Details
### Request Mapping
| Anthropic Field | Codex Payload | Notes |
|-----------------|---------------|-------|
| `model` | `model` | Map `gpt-5-codex` aliases; fall back to config default.
| `messages[]` | `messages[]` | For each content block, join `text` blocks; ignore unsupported block types for now; attach `tool_result` content as tool outputs.
| `system` | `instructions` | Forward when provided; still allow bridge prompt injection to run afterwards.
| `metadata.user_id` | `user_id` header (if required) | Optional.
| `temperature`, `top_p`, `top_k` | Copy into request body if Codex accepts them (safe to pass through even if ignored).
| `max_tokens` | `max_output_tokens` | Align with Codex naming.
| `stop_sequences` | `stop_sequences` | Direct copy.
| `tools`, `tool_choice` | Copy; ensure structure matches what Claude transformer expects (`tools: [{type:"function", function:{name, description, parameters}}]`).
| `stream` | `ClaudeModelRequest.stream` | Controls SSE response path.

### Response Mapping (non-stream)
- Expect Codex JSON to already resemble OpenAI Responses API; extract:
  - `id`, `model`, `stop_reason`, `usage` from response.
  - Convert primary assistant message to Anthropic format: `content: [{ type: "text", text: <assistant output> }]`.
  - Surface tool calls: convert Codex `output` items with `type: "output_text"` vs `tool_call` into Anthropic `content_block`s.
- Include `provider` metadata (`{ type: "proxy", name: "codex-gpt-5" }`) in response extensions if helpful.

### Response Mapping (stream)
- Wrap Fastify reply: set `content-type: text/event-stream`, disable compression, flush initial `event: ping` per Anthropic requirements.
- For each Codex SSE chunk:
  - Parse using `parseSseStream` helper into discrete events.
  - When `event === "response.created"`, emit Anthropic `data: {"type":"message_start", ...}`.
  - For partial text deltas, emit `content_block_delta` with incremental text.
  - When Codex signals completion (`response.completed`/`response.end`), emit `message_delta` with final usage and `message_stop` / `message_end` events, then `data: [DONE]` sentinel to close.
- Ensure heartbeats (`: keep-alive\n\n`) or `ping` events are forwarded to prevent Claude timeouts.

## Configuration & Environment Variables
Extend `loadConfig` to merge the following (keeping existing `CLAUDE_CODE_CODEX_*` for backwards compatibility):
- `PROXY_PORT` (default `4000`).
- `PROXY_HOST` (default `127.0.0.1`).
- `ANTHROPIC_AUTH_TOKEN` – required shared secret for inbound requests.
- `ANTHROPIC_ALLOWED_MODELS` – comma-separated list mapping to Codex models; default `gpt-5-codex,gpt-5`.
- `CODEX_MODE` (existing) – controls bridge prompt injection (`auto`/`force`/`disabled`).
- `CODEX_BRIDGE_PROMPT_PATH` – optional override for cached prompt file.
- Existing Codex OAuth envs remain unchanged.

Expose a lightweight `ProxyConfig` type in `src/server/types.ts` that augments `CodexConfig` with `port`, `host`, `authToken`, `allowedModels`.

## Bridge Prompt Strategy
- Reuse `shouldInjectPrompt` logic; default is `disabled`.
- Provide env override `CODEX_MODE=disabled` to disable injection entirely.
- Allow runtime query parameter `?bridge=0/1` for debugging but leave off by default (documented but optional).

## Implementation Outline
1. **Restructure Entrypoints** – Move current extension export to `src/extension.ts` (if we want to keep it) and create new `src/index.ts` that bootstraps the proxy server using `startProxy()`.
2. **Add Proxy Config** – Extend `CodexConfig` or introduce `ProxyConfig` that combines Codex + proxy fields; adjust `loadConfig` to read new env vars.
3. **Server Setup** – Add Fastify dependency, create `src/server/app.ts` building the server with shared dependencies (config, logger, `AuthManager`, `CodexFetchPipeline`). Register routes and export `createServer(config)`.
4. **Auth Middleware** – Implement reusable guard that validates the Authorization header and rejects unauthorized requests with structured Anthropic error payloads.
5. **Request Adapter** – Implement `buildClaudeRequest(anthropicRequest: MessagesPayload): ClaudeModelRequest` encapsulated in `src/proxy/anthropic-adapter.ts`. Include unit tests for mapping edge cases.
6. **Response Adapter** – Implement functions for JSON and streaming mode (`codexResponseToAnthropic`, `pipeCodexStreamToAnthropic`). Reuse existing SSE helpers to parse Codex chunks; add translation tests using fixture streams.
7. **Route Handlers** – In `src/server/routes/messages.ts`, orchestrate auth → adapt → pipeline → adapt response. Mirror for `/v1/complete`.
8. **Error Handling** – Centralise error conversion so thrown errors from pipeline or auth read as Anthropic error JSON with correct status.
9. **Scripts & Build** – Update `package.json` with `start`: `node dist/index.js` (after build) and optionally `dev`: `tsx src/index.ts`. Ensure `tsconfig` includes new files.
10. **Docs & README** – Update README to describe proxy usage, env vars, and smoke test instructions.

## Testing Plan
- **Unit Tests**
  - Extend existing suites for adapters (`tests/anthropic-adapter.test.ts`, `tests/streaming-adapter.test.ts`).
  - Verify auth middleware rejects bad/missing tokens.
  - Ensure bridge prompt injection decisions unchanged.
- **Integration Tests** (Vitest w/ supertest or Fastify inject):
  - `POST /v1/messages` JSON response path (non-stream) returns Anthropic schema.
  - Streaming path: simulate Codex SSE fixture and assert emitted Anthropic events.
  - `/v1/complete` request is converted correctly.
- **Existing Tests** – keep current suites green (auth/token store/transformer/response).

## Documentation Updates
- README: replace extension install guide with proxy usage instructions.
  - Steps to run `bun run build && node dist/index.js` (or `bun src/index.ts` during dev).
  - How to set Claude Code env vars (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_MODEL`).
  - Mention optional `CODEX_MODE` toggle and bridge prompt caching.
- Docs: update `docs/IMPLEMENTATION.md` to explain proxy architecture and remove extension references; mention `specs/PROMPTS.md` applicability.

## Smoke Test Checklist
1. `bun install` (if needed) and `bun run build`.
2. `PROXY_PORT=4000 ANTHROPIC_AUTH_TOKEN=secret bun node dist/index.js`.
3. In Claude Code settings, set:
   - `ANTHROPIC_BASE_URL=http://localhost:4000`
   - `ANTHROPIC_API_KEY=secret` (or `ANTHROPIC_AUTH_TOKEN` per docs naming).
   - `ANTHROPIC_MODEL=gpt-5-codex`
4. Start a Claude Code session and prompt “Say hello”.
5. Confirm proxy logs show transformed request, Codex response, and Claude displays Codex output.
6. Exercise a tool invocation to ensure bridge prompt + tool routing still works.
