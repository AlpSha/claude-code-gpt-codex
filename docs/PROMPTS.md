# Prompt Strategy for Claude Code Codex Integration

This document explains the bridge prompt used to align ChatGPT Codex responses with Claude Code's toolchain. Codex-specific system instructions are **not** injected; Claude Code's default instructions remain in place.

## Claude Code Bridge Prompt

Purpose: mirror the Codex CLI behaviour that maps Codex tool expectations onto Claude Code's commands, without referencing OpenCode or overriding Claude's base instructions.

### Content Guidelines

- **Tool Awareness**: list Claude Code's available tools (`write`, `edit`, `read`, `bash`, `grep`, `glob`, etc.) and any platform-specific utilities.
- **Substitution Rules**: instruct Codex to use Claude-native tools when it references Codex CLI defaults (e.g., `apply_patch` → `edit`, `update_plan` → `plan.write`).
- **Workflow Reminders**: emphasise Claude Code etiquette (brief preambles before tool usage, autonomous completion, testing expectations).
- **Advanced Integrations**: mention Claude Code’s Task tool or MCP integrations if available.
- **Formatting**: match the XML-like structure used by Codex (e.g., `<critical_rule priority="0">`) to maintain compatibility with Codex reasoning heuristics.

### Suggested Template

```
# Codex Running in Claude Code

You are operating Codex through Claude Code, an IDE-first coding environment. Claude Code supplies a different tool palette but follows the same safety and autonomy principles.

## Critical Tool Mapping

<critical_rule priority="0">
❌ APPLY_PATCH DOES NOT EXIST → ✅ USE "edit" INSTEAD
- NEVER call: apply_patch, applyPatch
- ALWAYS use: edit tool for file modifications
</critical_rule>

<critical_rule priority="0">
❌ PLAN.UPDATE DOES NOT EXIST → ✅ USE "plan.write" INSTEAD
- NEVER call: plan.update, update_plan
- ALWAYS use: plan.write to change plans; plan.read to review
</critical_rule>

## Available Tools

**File Operations**
- `write` – create files
- `edit` – modify files
- `read` – read file contents

**Search & Discovery**
- `grep` – search text
- `glob` – pattern matching
- `ls` – list directories

**Execution**
- `bash` – run shell commands

**Tasking & Context**
- `plan.read` – inspect current plan
- `plan.write` – update tasks
- `task.run` – launch specialised sub-agents (if available)

**MCP Tools**
- When MCP integrations are loaded, tool IDs follow `mcp__<server>__<tool>` naming.

## Verification Checklist

1. Am I using an approved tool name?
2. Am I respecting Claude Code's relative-path requirement?
3. Have I provided a concise preamble before invoking tools?
4. Have I planned to run relevant tests before delivering the final answer?

If any answer is "no", fix it before proceeding.

## Communication Style

- Keep status updates brief but informative.
- Defer to Claude Code's output formatting (no markdown tables unless requested).
- Complete the task before returning the final message.
```

### When to Inject

- Inject the bridge prompt **only** when the request contains tools. This mirrors the Codex CLI behaviour and avoids redundant instructions for chat-only interactions.
- If `CODEX_MODE=0`, skip bridge injection entirely.

## Prompt Verification

To avoid duplicate prompts and ensure idempotency:

1. Cache the first 200 characters of Claude Code's bootstrap prompt (if exposed) for string matching.
2. During request transformation, filter any duplicate developer/system prompt that the bridge prompt supersedes.
3. Replace it with the Claude bridge prompt when tools are present.

## Future Enhancements

- **Dynamic Tool Lists**: query Claude Code's tool registry at runtime and inject a generated section rather than a static list.
- **Localization**: allow optional localisation of the bridge prompt via config.
- **Telemetry Hooks**: add instrumentation to observe how often the prompt is injected and adjust wording based on success/failure patterns.
