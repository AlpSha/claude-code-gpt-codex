# Claude Code GPT-5 Codex Extension

This repository contains a Claude Code extension that authenticates against OpenAI's ChatGPT backend and proxies `gpt-5-codex` responses into Claude Code. It preserves Claude Code's native instructions and tooling while translating Codex-specific expectations (OAuth, request formatting, bridge prompt, streaming) into Claude-friendly equivalents.

## Features
- OAuth PKCE sign-in against ChatGPT Plus/Pro accounts with cached refresh tokens.
- Request transformer that normalises models, merges Codex CLI reasoning defaults, and injects a Claude-aware bridge prompt for tool runs.
- Streaming-safe fetch pipeline with automatic URL rewriting, header enrichment, and SSE helpers.
- Configurable via environment variables or optional JSON overrides (`~/.claude-code` friendly paths).
- Vitest suites covering configuration, transformer logic, OAuth helpers, token storage, and fetch utilities.

## Getting Started

### Prerequisites
- Node.js 20 or later
- npm 9+

### Installation
```bash
npm install
```

### Building the Extension
Compile TypeScript sources into `dist/`:
```bash
npm run build
```

### Registering with Claude Code
1. Copy or symlink the `dist/` directory into Claude Code's extension plugins folder (varies by platform). Consult Claude Code's documentation for the exact path.
2. Start Claude Code; the extension will load and register the `gpt-5-codex` transport automatically.

### Authenticating with ChatGPT
The first Codex request will trigger OAuth if no valid token cache is available.
1. Allow the extension to open a browser window pointing at `https://auth.openai.com/oauth/authorize`.
2. Complete login with a ChatGPT Plus/Pro account.
3. After the callback hits `http://localhost:1455/auth/callback`, the extension stores tokens at `~/.claude-code/auth/codex.json` (customisable).
4. Subsequent requests reuse and refresh tokens transparently.

## Configuration
Environment variables override defaults at runtime. Optionally, set `CLAUDE_CODE_CODEX_CONFIG` to point to a JSON file containing the same keys.

| Variable | Description | Default |
| --- | --- | --- |
| `CLAUDE_CODE_CODEX_BASE_URL` | ChatGPT backend base URL | `https://chatgpt.com/backend-api` |
| `CLAUDE_CODE_CODEX_CACHE_DIR` | Directory for cache artifacts (bridge prompt, etc.) | `~/.claude-code/cache` |
| `CLAUDE_CODE_CODEX_AUTH_PATH` | Location for OAuth token JSON | `~/.claude-code/auth/codex.json` |
| `CLAUDE_CODE_CODEX_CONFIG` | Optional JSON config path | *(unset)* |
| `CLAUDE_CODE_CODEX_DEBUG` | Enable verbose logging (`1`/`0`) | `0` |
| `CLAUDE_CODE_CODEX_ACCOUNT_ID` | Force an account ID header (testing) | decoded from JWT |
| `CODEX_MODE` | Prompt injection mode (`auto`, `force`, `disabled`, `1`, `0`) | `auto` |

Reasoning defaults follow Codex CLI parity (`reasoningEffort=medium`, `logic include=reasoning.encrypted_content`, `text.verbosity=medium`). Override them inside the config JSON's `defaults` object if needed.

## Repository Layout
```
src/
  auth/          # OAuth, token storage, browser helper
  config/        # Env/config loader merging defaults and overrides
  prompts/       # Claude bridge prompt and cache helpers
  request/       # Fetch pipeline, transformers, SSE utilities
  utils/         # Filesystem helpers, logging infrastructure
  types.ts       # Shared interfaces expected by Claude Code SDK
specs/           # Design documents provided for implementation
tests/           # Vitest coverage for core behaviours
docs/            # Copied implementation + prompt specs
```

## Development Workflow
```bash
npm install        # install dependencies
npm run typecheck  # verify TypeScript types
npm test           # run Vitest suite
npm run build      # emit dist/ bundle
```

### Debug Logging
Set `CLAUDE_CODE_CODEX_DEBUG=1` to surface pre/post transformation details, masked tokens, and response metadata in the console. Logs follow the `codex:<level>` prefix convention.

## Troubleshooting
- **OAuth window does not open**: manually open the URL from logs in a browser; the local server still captures the callback.
- **State mismatch/timeout**: rerun the flow; cached state is regenerated per attempt. Ensure no other process listens on port 1455.
- **`401 Unauthorized` after refresh**: delete the token store (`rm ~/.claude-code/auth/codex.json`) to force an interactive login.
- **Claude bridge prompt missing**: confirm `CODEX_MODE` isn’t set to `0`/`disabled` and that the request includes tool definitions.

## License
MIT (update as required for your distribution).
