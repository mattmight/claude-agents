# claude-agents

CLI and MCP server for inspecting and managing Claude Code sessions across all projects on a machine.

`claude-agents` reads the local `~/.claude/` filesystem to provide a unified view of projects, sessions, and their liveness status — filling a gap that Claude Code does not natively address.

## Status

**Milestone 9 complete** — Full CLI with watch mode, CSV output, exit codes, shell completions, symlinkable launcher + fully-featured MCP server.

See [PLAN.md](./PLAN.md) for the full design document and roadmap.

## Installation

```bash
npm install -g claude-agents
```

Or run directly with npx:

```bash
npx claude-agents status
```

Or symlink from a local clone (no global install, no npx overhead):

```bash
git clone <repo-url> && cd claude-agents
npm install && npm run build
ln -s "$(pwd)/bin/claude-agents" ~/bin/claude-agents
```

## Usage

```bash
# List all projects
claude-agents projects
claude-agents projects --active --sort last_active

# List sessions
claude-agents sessions
claude-agents sessions /path/to/project
claude-agents sessions --active --json
claude-agents sessions --latest --limit 10
claude-agents sessions --since 7d --sort status

# Inspect a session (full UUID or prefix)
claude-agents inspect a1b2c3d4
claude-agents inspect a1b2c3d4-e5f6-7890-abcd-ef1234567890

# Status dashboard
claude-agents status

# Live-updating status (re-scans every 5 seconds)
claude-agents status --watch
claude-agents status --watch --interval 10

# Start MCP server (stdio transport)
claude-agents serve

# CSV output for sessions
claude-agents sessions --format csv
claude-agents sessions --active --format csv > active-sessions.csv

# Watch for session changes (streaming NDJSON)
claude-agents watch
claude-agents watch --interval 2

# Start MCP server (stdio transport)
claude-agents serve

# Start MCP server (HTTP+SSE transport)
claude-agents serve --sse --port 3100

# Shell completions
eval "$(claude-agents completions bash)"   # bash
eval "$(claude-agents completions zsh)"    # zsh
claude-agents completions fish | source    # fish

# Global options
claude-agents --json projects         # JSON output
claude-agents --no-color sessions     # No ANSI colors
claude-agents --claude-dir /path sessions  # Custom data dir
```

## MCP Server Setup

### Stdio transport (default)

Add to your Claude Code configuration (`~/.claude/settings.json` or `.mcp.json`):

```json
{
  "mcpServers": {
    "claude-agents": {
      "command": "claude-agents",
      "args": ["serve"]
    }
  }
}
```

### HTTP+SSE transport (network-accessible)

Start the server:

```bash
claude-agents serve --sse --port 3100
```

Connect MCP clients to `http://localhost:3100/mcp`.

### MCP Tools

| Tool | Description |
|------|-------------|
| `list_projects` | List projects with `active_only`, `sort_by` filters |
| `list_sessions` | List sessions with `project_path`, `active_only`, `latest_only`, `limit`, `since`, `sort_by` filters |
| `inspect_session` | Get session detail by UUID or prefix |
| `get_status` | Aggregate dashboard summary |
| `find_session` | Search sessions by summary, branch, or first prompt text |

### MCP Resources

| URI | Description |
|-----|-------------|
| `claude-agents://projects` | Full project list |
| `claude-agents://projects/{encoded_dir}` | Single project with all sessions |
| `claude-agents://sessions/{session_id}` | Single session detail |
| `claude-agents://status` | Aggregate status summary |

### MCP Prompts

| Prompt | Description |
|--------|-------------|
| `session_overview` | Summary of all active sessions |
| `project_history` | Recent session history for a project (accepts `project_path`) |
| `find_work` | Find a session by description (accepts `description`) |

### Troubleshooting

**MCP server not responding:**
- Verify the server starts: `claude-agents serve` should block waiting for input (no error output).
- Check that the `command` path in your `.mcp.json` resolves to the installed binary: `which claude-agents`.
- For SSE mode, ensure the port is not already in use: `lsof -i :3100`.

**No projects or sessions found:**
- Verify Claude Code data exists: `ls ~/.claude/projects/`.
- If using `--claude-dir`, ensure the path points to a valid Claude data directory.

**Session shows "stopped" but is actually running:**
- The liveness check reads `~/.claude/sessions/<PID>.json`. If Claude Code doesn't create this file (older versions), liveness falls back to JSONL mtime recency.
- Try `--since 1m` to see recently active sessions.

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (invalid arguments, session not found, etc.) |
| `2` | No matching results when a filter was applied (`--active`, `--since`, project path) |

Useful for scripting:

```bash
claude-agents sessions --active || echo "No active sessions"
```

## Development

### Prerequisites

- Node.js >= 18

### Setup

```bash
npm install
```

### Build

```bash
npm run build
```

### Test

```bash
npm test
```

### Lint

```bash
npm run lint
```

## Architecture

### CLI (`src/cli.ts`)

Entry point using Commander.js. Parses global options (`--json`, `--no-color`, `--claude-dir`, `--verbose`) and dispatches to command handlers.

### Commands

- **`src/commands/projects.ts`** — `claude-agents projects` with `--active` and `--sort` (path, last_active, session_count)
- **`src/commands/sessions.ts`** — `claude-agents sessions` with `--active`, `--latest`, `--limit`, `--sort`, `--since`, `--format` (table/json/csv), and optional `[project-path]` filter
- **`src/commands/inspect.ts`** — `claude-agents inspect <session-id>` with full UUID or unique prefix resolution
- **`src/commands/status.ts`** — `claude-agents status` summary dashboard with `--watch` and `--interval`
- **`src/commands/serve.ts`** — `claude-agents serve` starts the MCP server (stdio or HTTP+SSE)
- **`src/commands/watch.ts`** — `claude-agents watch` streaming NDJSON events for session changes
- **`src/commands/completions.ts`** — `claude-agents completions <bash|zsh|fish>` generates shell completion scripts

### MCP Server

- **`src/mcp/server.ts`** — MCP server creation with stdio and HTTP+SSE transport options, signal handling (SIGINT, SIGTERM)
- **`src/mcp/tools.ts`** — Registers five MCP tools with Zod input schemas
- **`src/mcp/resources.ts`** — Registers four MCP resources (2 static, 2 template-based with list and completion callbacks)
- **`src/mcp/prompts.ts`** — Registers three MCP prompt templates with argument schemas

### Formatters

- **`src/formatters/table.ts`** — Human-readable table output with status indicators (● active, ◎ likely_active, ○ stopped)
- **`src/formatters/json.ts`** — Structured JSON output with snake_case keys
- **`src/formatters/csv.ts`** — CSV output for sessions with proper quoting
- **`src/formatters/inspect.ts`** — Detail view and JSON for single session inspect
- **`src/formatters/status.ts`** — Dashboard view and JSON for aggregate status

### Utilities

- **`src/utils/colors.ts`** — Thin ANSI color wrapper (no chalk dependency), respects `--no-color` and `NO_COLOR` env
- **`src/utils/duration.ts`** — Parses duration strings (`1h`, `7d`, `30m`) for `--since` filtering

### Core Modules

- **`src/core/scanner.ts`** — Walks `~/.claude/projects/` and returns encoded directory names.
- **`src/core/path-resolver.ts`** — Resolves encoded directory names back to real filesystem paths using a fallback chain:
  1. `sessions-index.json` → `originalPath` field
  2. `history.jsonl` → streaming parse to match encoded paths
  3. Returns `null` with a warning flag if neither source resolves the path
- **`src/core/session-enumerator.ts`** — Enumerates sessions per project or across all projects:
  - `enumerateProjectSessions()` — parses `sessions-index.json` or falls back to JSONL file scanning
  - `enumerateAllSessions()` — batch enumeration across all projects
  - `discoverSubAgents()` — finds `agent-*.jsonl` sub-agents and reads their `.meta.json`
- **`src/core/history-parser.ts`** — Streaming parser for `history.jsonl`:
  - `parseHistoryBySession()` — groups entries by session with timestamps and prompt counts
  - `streamHistory()` — low-level line-by-line streaming API
- **`src/core/liveness.ts`** — Session liveness detection:
  - `getSessionsDir()` — returns the path to `~/.claude/sessions/`
  - `checkSessionLiveness()` — checks a single session against the process registry and JSONL recency
  - `checkAllSessionsLiveness()` — batch liveness check, reads registry once
- **`src/core/watcher.ts`** — Filesystem watcher for `~/.claude/projects/` with debouncing (100ms default). Used by MCP subscriptions and CLI `--watch` mode.

### Key Types

- `ProjectEntry` — A discovered project with its encoded dir, resolved real path, and resolution metadata.
- `Session` — A session with ID, project path, branch, summary, message count, timestamps, JSONL path/size, sub-agents, status, pid.
- `SubAgent` — A sub-agent with ID, JSONL path, agent type, and description.
- `SessionsIndex` / `SessionsIndexEntry` — TypeScript interfaces matching the on-disk `sessions-index.json` format.
- `HistoryEntry` / `HistorySessionData` — History line format and per-session aggregated data.
- `SessionStatus` — `"active" | "likely_active" | "stopped" | "unknown"`.
- `LivenessResult` / `LivenessOptions` — Liveness check result and configuration.

## License

MIT
