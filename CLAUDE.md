# CLAUDE.md

## Project Overview

`claude-agents` is a CLI tool and MCP server for inspecting and managing Claude Code sessions across all projects on a machine. It reads from `~/.claude/` to provide project discovery, session enumeration, liveness detection, and search. The `delete` command is the only operation that writes to `~/.claude/`.

## Build & Test

```bash
npm install          # Install dependencies
npm run build        # TypeScript compilation (tsc)
npm run lint         # ESLint
npm test             # Vitest (all tests)
npm run typecheck    # Type-check without emitting
```

CI runs on GitHub Actions (Ubuntu + macOS, Node 18/20/22).

## Architecture

- **`src/core/`** — Pure data modules (scanner, path-resolver, session-enumerator, liveness, history-parser, watcher, session-deleter). No I/O formatting.
- **`src/commands/`** — CLI command handlers (projects, sessions, inspect, delete, status, serve, watch, completions). Orchestrate core modules and delegate to formatters.
- **`src/formatters/`** — Pure functions returning strings (table, json, csv, inspect, status). No stdout writes.
- **`src/mcp/`** — MCP server (server.ts), tool registration (tools.ts), resource registration (resources.ts), prompt templates (prompts.ts).
- **`src/utils/`** — Small utilities (colors, duration parsing).
- **`src/cli.ts`** — CLI entry point (Commander.js). Separate from library entry point (`src/index.ts`).
- **`src/index.ts`** — Library entry point. Re-exports core functions and types for programmatic use.
- **`bin/claude-agents`** — Symlinkable bash launcher. Uses local `dist/cli.js` when available, falls back to `npx`.

## Key Patterns

- **ESM only** — `"type": "module"` in package.json, `.js` extensions in imports.
- **Zod for MCP schemas** — Tool and prompt input schemas use Zod, auto-converted to JSON Schema by the MCP SDK.
- **Snake_case in JSON output** — All JSON output (CLI `--json`, MCP tool responses, MCP resources) uses snake_case keys.
- **CommandResult pattern** — `runProjectsCommand` and `runSessionsCommand` return `{output: string, isEmpty: boolean}` to support exit code 2.
- **Fixture-based testing** — Tests use `test/fixtures/mock-claude-dir/` with realistic Claude Code directory structures. MCP integration tests use `InMemoryTransport.createLinkedPair()`. Edge case fixtures at `test/fixtures/empty-claude-dir/` and `test/fixtures/corrupted-claude-dir/`.
- **`process.kill` mocking** — Liveness tests mock `process.kill` via `vi.spyOn` since fixture PIDs aren't real processes.
- **No chalk dependency** — Colors use a thin ANSI wrapper in `src/utils/colors.ts`.
- **Read-only** — The tool never modifies any Claude Code state files, except for the `delete` command which removes session artifacts.

## Test Structure

Tests mirror the source layout:
- `test/` — Core module tests + MCP integration tests + edge case tests + exit code tests
- `test/commands/` — Command handler tests (including watch and completions)
- `test/formatters/` — Formatter unit tests (including csv)
- `test/utils/` — Utility tests

## CLI Commands

- `projects` — List projects (`--active`, `--sort`)
- `sessions` — List sessions (`--active`, `--latest`, `--limit`, `--sort`, `--since`, `--format`, `[project-path]`)
- `inspect <session-id>` — Session detail (UUID or prefix)
- `delete [session-id]` — Delete session(s) and all artifacts (`--dry-run`, `--force`, `--all-stopped`, `--before`, `--project`, `--prune-history`)
- `status` — Dashboard (`--watch`, `--interval`)
- `serve` — MCP server (`--sse`, `--port`)
- `watch` — Streaming NDJSON events (`--interval`)
- `completions <shell>` — Shell completion scripts (bash, zsh, fish)

## Exit Codes

- `0` — Success
- `1` — Error
- `2` — No matching results (when a filter like `--active` was applied)

## Dependencies

- **`commander`** — CLI argument parsing
- **`@modelcontextprotocol/sdk`** — MCP server SDK (brings `zod` as transitive dep)
