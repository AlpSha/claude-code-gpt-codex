# Claude Code GPT-5 Codex OAuth Integration

This document describes how to build a Claude Code extension that authenticates against OpenAI's ChatGPT backend (Codex) and exposes `gpt-5-codex` functionality inside Claude Code. The design intentionally avoids OpenCode support and never injects Codex-specific system instructions—Claude Code's default instructions remain in control.

## Goals

- Authenticate with ChatGPT Plus/Pro via OAuth (PKCE) and reuse subscription credits.
- Preserve the Codex CLI request pipeline while adapting it to Claude Code's extension API.
- Rely on Claude Code's built-in system instructions; only add a Claude-flavoured bridge prompt when tool hints are required.
- Persist tokens and cache files in Claude Code-friendly locations.
- Offer clear environment-variable configuration for base URLs, token cache paths, and debugging.

## High-Level Architecture

```
claude-extension/
├── src/
│   ├── index.ts                 # Claude Code extension entry point
│   ├── auth/
│   │   ├── oauth.ts             # PKCE flow, token exchange, refresh
│   │   ├── server.ts            # Local callback server (port 1455)
│   │   └── browser.ts           # Attempts to open the auth URL
│   ├── request/
│   │   ├── fetch.ts             # 7-step fetch pipeline (transform + fetch + handle)
│   │   ├── transformer.ts       # Request body normalization and bridge prompt injection
│   │   └── response.ts          # SSE → JSON helpers
│   ├── prompts/
│   │   └── claude-bridge.ts     # Claude Code bridge prompt for tool awareness
│   ├── config/
│   │   └── index.ts             # Merges env vars + optional `~/.claude-code` config
│   └── types.ts                 # Shared TypeScript interfaces
├── docs/
│   ├── IMPLEMENTATION.md        # (this file)
│   └── PROMPTS.md               # Bridge prompt strategy
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Seven-Step Fetch Flow (Claude Edition)

1. **Token Management** – Read cached OAuth tokens, refresh when `expires < Date.now()` using the refresh token, then persist the new credentials.
2. **URL Rewriting** – Rewrite Claude Code's `https://chatgpt.com/backend-api/responses` requests to the Codex endpoint `https://chatgpt.com/backend-api/codex/responses`.
3. **Request Transformation** – Normalize model IDs (`gpt-5-codex`/`gpt-5`), merge reasoning/text config, optionally prepend the Claude bridge prompt when developer tools are present, and remove stateless history artifacts (`rs_*`). Do **not** override Claude Code's default instructions field.
4. **Header Injection** – Attach the OAuth `Authorization` bearer token, ChatGPT account ID, `OpenAI-Beta: responses=experimental`, originator, and random session ID.
5. **Execution** – Send the request with `fetch` (Node 20+), honour streaming via SSE when requested.
6. **Logging** – Optional debug logging when `ENABLE_PLUGIN_REQUEST_LOGGING=1`; log before/after transformation and response metadata.
7. **Response Handling** – Convert SSE payloads to JSON for non-tool calls; pass through raw streams otherwise.

## Implementation Steps

### 1. Bootstrap the Repository

- Initialise a Node 20+ TypeScript project (`npm init`, `tsconfig.json` targeting ES2022 + module=ES2022).
- Install dependencies:
  - Runtime: `@openauthjs/openauth`
  - Dev: Claude Code extension SDK (`@anthropic-ai/claude-code-sdk` or equivalent), `typescript`, `vitest`.

### 2. Define Configuration

Create `src/config/index.ts` with:

- Default values tuned for Codex CLI parity: `reasoningEffort="medium"`, `reasoningSummary="auto"`, `textVerbosity="medium"`, `include=["reasoning.encrypted_content"]`.
- Environment variables (all optional, with sane defaults):
  - `CLAUDE_CODE_CODEX_BASE_URL` (default `https://chatgpt.com/backend-api`).
  - `CLAUDE_CODE_CODEX_CACHE_DIR` (default `~/.claude-code/cache`).
  - `CLAUDE_CODE_CODEX_CONFIG` optional path for JSON overrides.
  - `CLAUDE_CODE_CODEX_DEBUG` toggles verbose logging.
- A loader that merges env vars ⟶ config file ⟶ defaults.

### 3. Implement OAuth Flow (`src/auth/`)

Repurpose the Codex CLI OAuth flow:

- `oauth.ts`: PKCE generation (`@openauthjs/openauth/pkce`), `CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"`, authorise URL `https://auth.openai.com/oauth/authorize`, token URL `https://auth.openai.com/oauth/token`, scope `openid profile email offline_access`.
- `server.ts`: Local HTTP server on port `1455` that captures `GET /auth/callback?code=...&state=...` and resolves a promise with the code. Ensure clean shutdown.
- `browser.ts`: Attempt to open the authorisation URL using platform-specific commands (`open`, `start`, `xdg-open`).
- Token persistence: read/write JSON at `~/.claude-code/auth/codex.json` (configurable) containing `{ access, refresh, expires }`.

### 4. Claude Code Entry Point (`src/index.ts`)

Implement the extension contract expected by Claude Code (pseudo-interface `ClaudeExtension`):

```ts
export const CodexExtension: ClaudeExtension = ({ secrets, http, logger }) => ({
  auth: {
    label: "ChatGPT Plus/Pro OAuth",
    async loader() { /* Step 1-7 orchestrator */ },
    async authorize() { /* Launch browser + wait for callback */ },
  },
});
```

Inside the loader:

1. Retrieve cached auth (`readTokens()`); if missing, throw to prompt the user to run the OAuth method.
2. Decode the JWT (`decodeJWT`) to extract `chatgpt_account_id` from the `https://api.openai.com/auth` claim.
3. Load merged configuration (global + per-model options).
4. Return Claude Code provider settings: dummy API key (`chatgpt-oauth`), base URL (default or overridden), and the custom `fetch` implementation from `src/request/fetch.ts`. No additional instructions are injected; Claude Code supplies them.

### 5. Fetch Pipeline (`src/request/fetch.ts`)

Expose a function `createCodexFetch({ getAuth, setAuth })` that returns an async `(input, init) => Response`. Steps:

- Guard against stale tokens (`shouldRefreshToken`); if `expires <= now`, call `refreshAccessToken` and persist via `setAuth`.
- Extract the request URL, rewrite `/responses` → `/codex/responses`.
- If `init.body` exists, parse JSON, call `transformRequestBody()` to normalize models, merge config, prune history, and optionally inject the Claude bridge prompt, then stringify the result.
- Build headers via `createCodexHeaders()`.
- Execute `fetch` and run through `handleErrorResponse`/`handleSuccessResponse` utilities.

### 6. Request Transformation (`src/request/transformer.ts`)

Key responsibilities:

- `normalizeModel(model: string | undefined)` → `gpt-5-codex` when `includes("codex")`, else `gpt-5`.
- Merge config with model-specific overrides (Claude Code exposes per-model options similar to the OpenCode config schema).
- Enforce `store=false`, `stream=true`, and preserve whatever `instructions` Claude supplied (never overwrite).
- Filter input history to remove response IDs (`rs_*`).
- When tools are present, prepend the Claude bridge prompt (detailed in `docs/PROMPTS.md`).
- Compute reasoning config (`getReasoningConfig`) with default `medium` (codex) and degrade `minimal`→`low` for Codex requests.
- Normalize text verbosity to `medium` unless overridden.

### 7. Prompt Management (`src/prompts/claude-bridge.ts`)

- Export a bridge prompt tailored to Claude Code tool names (see `docs/PROMPTS.md`).
- Provide helper functions to cache the bridge text if you want to avoid repeated file reads, but no Codex instruction downloads are needed.

### 8. Token & Cache Storage

- Tokens: `~/.claude-code/auth/codex.json`
- Cache: `~/.claude-code/cache/`
  - `claude-tooling-bridge.txt` (optional cached prompt)

Ensure directories are created lazily with `fs.mkdir({ recursive: true })`.

### 9. Logging & Debugging

- Provide a `logger` wrapper that no-ops unless `CLAUDE_CODE_CODEX_DEBUG=1`.
- Include `logRequest(stage, payload)` to capture request/response metadata. Mask tokens before logging.

### 10. Testing Strategy

- Mirror the original plugin's 120+ tests using Vitest.
- Key suites:
  - `auth.test.ts` – PKCE generation, token parsing, state validation.
  - `fetch-helpers.test.ts` – URL rewriting, header creation, refresh flow.
  - `transformer.test.ts` – Model normalization, bridge prompt injection, reasoning config.
  - `config.test.ts` – Env precedence, config file parsing, defaults.
- Mock network calls (`fetch-mock`) for token endpoints. No GitHub mocks required since Codex instructions are unused.

### 11. Build & Distribution

- `npm run build` → compile TypeScript to `dist/` via `tsc` and copy static assets (e.g., `auth-success.html`).
- Publish as `claude-code-gpt5-codex-auth` (or private bundle) with appropriate metadata.
- Document minimal installation in the repo README: place the compiled extension in Claude Code's plugin directory, then run the OAuth flow once.

## Environment Variables Summary

| Variable | Purpose | Default |
|----------|---------|---------|
| `CLAUDE_CODE_CODEX_BASE_URL` | Override ChatGPT backend base URL | `https://chatgpt.com/backend-api` |
| `CLAUDE_CODE_CODEX_ACCOUNT_ID` | Optional manual override for account ID (useful for testing) | extracted from JWT |
| `CLAUDE_CODE_CODEX_CACHE_DIR` | Cache directory | `~/.claude-code/cache` |
| `CLAUDE_CODE_CODEX_AUTH_PATH` | Token storage path | `~/.claude-code/auth/codex.json` |
| `CLAUDE_CODE_CODEX_CONFIG` | Path to JSON config overrides | *(none)* |
| `CLAUDE_CODE_CODEX_DEBUG` | Enable verbose logging (1/0) | 0 |
| `CODEX_MODE` | Force bridge prompt behaviour (1 enable, 0 disable) | 0 |

## Example `.env`

```
CLAUDE_CODE_CODEX_BASE_URL=https://chatgpt.com/backend-api
CLAUDE_CODE_CODEX_AUTH_PATH=/Users/alice/.claude-code/auth/codex.json
CLAUDE_CODE_CODEX_CACHE_DIR=/Users/alice/.claude-code/cache
CLAUDE_CODE_CODEX_DEBUG=1
```

## Developer Workflow Checklist

1. **Install dependencies**: `npm install`.
2. **Run tests**: `npm test`.
3. **Build**: `npm run build` (ensures OAuth success HTML copied to `dist/`).
4. **Link into Claude Code**: symlink or copy the `dist/` bundle as required by Claude Code.
5. **Authenticate**: trigger the OAuth method from within Claude Code; browser opens at `https://auth.openai.com/oauth/authorize`. Complete login.
6. **Verify**: open Claude Code terminal, issue a test command; confirm responses originate from `gpt-5-codex`.

## Appendix: Migration Notes

- The Claude bridge prompt replaces any OpenCode-specific guidance; see `docs/PROMPTS.md`.
- All references to `@opencode-ai/*` packages are removed; replace with Claude Code SDK types.
- Default reasoning/text values mimic the Codex CLI rather than Anthropic defaults to ensure parity with ChatGPT behaviour.
- If Claude Code already uses env vars like `ANTHROPIC_BASE_URL`, document how to set the Codex-specific ones alongside them; two providers can coexist.
