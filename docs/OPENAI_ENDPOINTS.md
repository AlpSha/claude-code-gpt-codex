# OpenAI Codex Backend Endpoints

This document explains how the proxy interacts with OpenAI's ChatGPT Codex backend so you can reason about failures and verify requests. All examples assume the proxy is translating Anthropic-style payloads from Claude Code into Codex-compatible calls.

## Base URL & Paths

- **Base URL**: `https://chatgpt.com/backend-api`
- **Codex Responses Endpoint**: `POST https://chatgpt.com/backend-api/codex/responses`
  - All incoming requests that target `.../responses` are rewritten to `.../codex/responses` before being sent upstream (see `lib/request/fetch-helpers.ts:95`).

## Required Headers

| Header | Value | Notes |
|--------|-------|-------|
| `Authorization` | `Bearer <access_token>` | The OAuth access token obtained via the ChatGPT Plus/Pro flow (`lib/request/fetch-helpers.ts:172`). |
| `chatgpt-account-id` | `<account_id>` | Extracted from JWT claim `https://api.openai.com/auth.chatgpt_account_id` (`index.ts:72-78`). |
| `OpenAI-Beta` | `responses=experimental` | Enables the responses API variant used by Codex (`lib/constants.ts:33-40`). |
| `originator` | `codex_cli_rs` | Required by the backend to attribute traffic (`lib/constants.ts:39-41`). |
| `session_id` | `<uuid>` | Random UUID per request to match Codex CLI behaviour (`lib/request/fetch-helpers.ts:182`). |
| `Content-Type` | `application/json` | Always JSON payloads. |

## Request Body Schema

Codex expects a superset of the standard responses API. The proxy normalises the body via `transformRequestBody()` (`lib/request/request-transformer.ts:205-288`). Key fields:

```jsonc
{
  "model": "gpt-5-codex",        // Normalised from any Codex variant
  "store": false,                 // Stateless operation requirement
  "stream": true,                 // Allows SSE streaming
  "input": [ ... ],               // Conversation array (see below)
  "tools": [ ... ],               // Optional tool definitions
  "reasoning": {
    "effort": "medium",         // Merged from config + defaults
    "summary": "auto"
  },
  "text": {
    "verbosity": "medium"       // Default verbosity
  },
  "include": ["reasoning.encrypted_content"],
  "max_output_tokens": null,
  "max_completion_tokens": null
}
```

### Conversation Items (`input`)

Each conversation entry is shaped like Codex's responses payload:

```jsonc
{
  "type": "message",
  "role": "user" | "assistant" | "developer",
  "content": [
    {
      "type": "input_text",
      "text": "..."
    }
  ]
}
```

The proxy filters out historic response IDs (`id` fields starting with `rs_`) so Codex treats the call as stateless (`filterInput()` in `lib/request/request-transformer.ts:118-151`).

### Instructions Field

By default the proxy leaves Claude Code's system instructions untouched. If the upstream payload already contains an `instructions` field, it is passed through; no Codex text is injected.

## Streaming Responses

Codex streams Server-Sent Events (SSE) back to the client. The proxy handles the stream inside `handleSuccessResponse()` (`lib/request/fetch-helpers.ts:152-157`), converting SSE frames to JSON when no tools are involved. Tool-based responses are forwarded verbatim so Claude Code can handle them natively.

Event format (simplified):

```
data: {"type":"message","delta":{"content":[{"type":"output_text","text":"..."}]}}

data: {"type":"message","message":{"id":"..."}}

data: {"type":"response.completed"}

```

## Error Handling

- Non-2xx responses trigger `handleErrorResponse()` (`lib/request/fetch-helpers.ts:187-220`), which logs body text and returns a JSON error to the caller.
- Expired tokens are refreshed via `refreshAccessToken()` (`lib/auth/auth.ts:67-116`). If refresh fails, a `401` error is returned to trigger re-authentication.

## Example Request

```bash
curl -X POST \
  https://chatgpt.com/backend-api/codex/responses \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "chatgpt-account-id: <ACCOUNT_ID>" \
  -H "OpenAI-Beta: responses=experimental" \
  -H "originator: codex_cli_rs" \
  -H "session_id: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{
        "model": "gpt-5-codex",
        "store": false,
        "stream": true,
        "input": [
          {
            "type": "message",
            "role": "user",
            "content": [
              { "type": "input_text", "text": "List files in the repo" }
            ]
          }
        ],
        "reasoning": { "effort": "medium", "summary": "auto" },
        "text": { "verbosity": "medium" },
        "include": ["reasoning.encrypted_content"]
      }'
```

This mirrors the request constructed inside the proxy after transforming the Anthropic-style payload.

## Tips for Debugging

1. **Enable Logging**: set `CLAUDE_CODE_CODEX_DEBUG=1` to print pre/post transformation payloads and response metadata through `logRequest()`.
2. **Check Tokens**: ensure the cached credential file contains fresh `access`, `refresh`, and `expires`. Stale entries will produce `401 Unauthorized` errors.
3. **Verify Headers**: missing `chatgpt-account-id` or `OpenAI-Beta` will cause OpenAI to reject the call.
4. **SSE Issues**: use `curl -N` or a tool like `sse-cat` to inspect the raw Codex stream if parsing failures occur.
5. **Rate Limits**: Codex enforces per-account quotas; repeated `429` responses mean you’ve hit the limit—back off or try later.

## Mapping from Anthropic Payloads

When Claude Code issues an Anthropic `/v1/messages` request, the proxy:

1. Validates the bearer token (`ANTHROPIC_AUTH_TOKEN`) matches its expected shared secret.
2. Maps the payload fields to Codex equivalents (`model`, `messages` → `input`, `tools` preserved, streaming flag forwarded).
3. Calls the Codex endpoint as described above.
4. Translates the Codex response back into Anthropic-compatible JSON (assistant messages, tool calls, stop reasons) before returning to Claude Code.

Understanding the upstream Codex contract makes it much easier to diagnose translation errors and confirm the proxy behaves like an official Codex CLI client.
