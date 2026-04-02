# `claude-agents` — Design Document

## Overview

`claude-agents` is a command-line tool and MCP server for inspecting and managing Claude Code sessions across all projects on a machine. It reads the local `~/.claude/` filesystem to provide a unified view of projects, sessions, and their liveness status — filling a gap that Claude Code does not natively address. As a CLI it provides direct terminal access; as an MCP server it lets Claude Code sessions, Claude.ai, and custom orchestrators query the same data programmatically.

### Problem Statement

Claude Code stores session data across a fragmented filesystem layout under `~/.claude/projects/`. Directory names are lossy-encoded (both `/` and `.` map to `-`), there is no lock file or PID tracking for active sessions, and the built-in `--resume` picker is scoped to a single project directory. Developers running multiple parallel sessions — especially in orchestration scenarios — have no single-pane view of what is running, what has stopped, and where.

### Goals

1. List all known projects (by real filesystem path, not encoded directory name).
2. List all sessions across all projects, or filtered to a single project.
3. Detect which sessions are **active** (have a running Claude Code process attached).
4. Provide both human-readable and machine-readable (JSON) output.
5. **Expose all functionality as an MCP server**, allowing Claude Code sessions, Claude.ai, and other MCP clients to query project and session state as tools and resources.
6. Remain read-only — never modify Claude Code's state.
7. Work on macOS and Linux without elevated privileges.

### Non-Goals

- Launching, stopping, or resuming Claude Code sessions (use `claude --resume` for that).
- Modifying `sessions-index.json`, JSONL transcripts, or any Claude state files.
- Replacing `agentd` or other orchestration frameworks — this is a diagnostic/inspection tool that orchestrators can call.

---

## Architecture

### Data Sources

`claude-agents` reads from three on-disk data sources, all under `~/.claude/`:

| Source | Location | Contents |
|--------|----------|----------|
| **Global history** | `~/.claude/history.jsonl` | One JSON object per user input across all projects. Contains `prompt`, `timestamp`, `cwd` (real path), and `sessionId`. |
| **Project directories** | `~/.claude/projects/<encoded-path>/` | Per-project folders. Folder name encodes the absolute working directory (non-alphanumeric chars → `-`). Contains session JSONL files and `sessions-index.json`. |
| **Session index** | `~/.claude/projects/<encoded-path>/sessions-index.json` | Structured metadata: session ID, auto-generated summary, message count, git branch, creation/modification timestamps. Canonical source for the real working directory path. |
| **Session env** | `~/.claude/session-env/<session-id>/` | Per-session environment data. Presence is not a reliable liveness signal (entries accumulate and are not cleaned up). |

### Path Resolution Strategy

Because the folder-name encoding is lossy (`/`, `.`, and potentially other non-alphanumeric characters all collapse to `-`), the tool **never** reverse-engineers the folder name. Instead:

1. **Primary**: Parse `sessions-index.json` inside each project directory for the canonical `cwd` / working directory field.
2. **Fallback**: Parse `history.jsonl` entries, which contain the real `cwd` per prompt.
3. **Last resort**: If neither source contains the path, display the encoded folder name with a warning marker.

### Liveness Detection

There is no official lock file mechanism (this is an open feature request: [anthropics/claude-code#19364](https://github.com/anthropics/claude-code/issues/19364)). The tool uses a layered heuristic:

1. **Process table scan** — Enumerate all running processes matching the Claude Code binary. Extract the working directory of each process (via `/proc/<pid>/cwd` on Linux, `lsof -p <pid>` on macOS). Match against known project paths.
2. **PID file check (future-proof)** — If `~/.claude/projects/<encoded>/<session-id>.lock` or `.pid` files exist (anticipated from the feature request), read and validate with `kill(pid, 0)`.
3. **Recency heuristic** — If the session's JSONL file was modified within the last N seconds (default: 30), mark as `likely_active`. This catches SDK-based headless sessions that may not appear as a distinct `claude` process.
4. **CLAUDECODE env var** — Not usable externally (only visible from within the process tree).

Each session gets a status enum:

```
active       — confirmed running process matched to this session
likely_active — JSONL modified within recency window, no process confirmed
stopped      — no matching process, JSONL stale
unknown      — insufficient data to determine
```

### Output Modes

All commands support `--json` for machine-readable output and `--color` / `--no-color` for terminal control.

### MCP Server Architecture

`claude-agents` doubles as an MCP (Model Context Protocol) server, exposing the same core logic that powers the CLI through a standardized tool-and-resource interface. This allows any MCP client — including Claude Code itself, Claude.ai with connected MCPs, or custom orchestrators — to query project and session state programmatically.

**Transport:** The MCP server uses **stdio** transport by default (the standard for local MCP servers invoked by Claude Code). An optional `--sse` flag enables HTTP+SSE transport for network-accessible scenarios (e.g., a shared development server).

**Dual entry point:** The same `claude-agents` binary serves both roles:

```bash
# CLI mode (default)
claude-agents projects --active

# MCP server mode
claude-agents serve                 # stdio transport
claude-agents serve --sse --port 3100  # HTTP+SSE transport
```

**Registration:** Users add the server to their Claude Code configuration:

```json
// ~/.claude/settings.json or .mcp.json
{
  "mcpServers": {
    "claude-agents": {
      "command": "claude-agents",
      "args": ["serve"]
    }
  }
}
```

**Core reuse:** The MCP tool handlers call directly into the same `core/scanner.ts`, `core/liveness.ts`, and `core/path-resolver.ts` modules that the CLI commands use. No logic is duplicated — the MCP layer is a thin adapter over the shared core.

**Tools vs Resources:** The MCP interface exposes both:

- **Tools** — for parameterized queries (list projects with filters, search sessions, inspect a session by ID). These are the primary interface for LLM-driven interaction.
- **Resources** — for URI-addressable, cacheable data (individual project metadata, individual session metadata). These enable MCP clients to subscribe to specific entities and receive change notifications.

#### MCP Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `list_projects` | List all known projects with session counts and status | `active_only?: boolean`, `sort_by?: "path" \| "last_active" \| "session_count"` |
| `list_sessions` | List sessions, optionally filtered by project | `project_path?: string`, `active_only?: boolean`, `latest_only?: boolean`, `limit?: number`, `since?: string`, `sort_by?: "time" \| "project" \| "status"` |
| `inspect_session` | Get detailed metadata for a single session | `session_id: string` (full UUID or unique prefix) |
| `get_status` | Get aggregate dashboard summary | _(none)_ |
| `find_session` | Search sessions by summary text or branch name | `query: string`, `limit?: number` |

All tools return structured JSON matching the Data Model types defined below. Error responses use standard MCP error codes.

#### MCP Resources

Resources use a URI scheme rooted at `claude-agents://`:

| URI Pattern | Description | Example |
|-------------|-------------|---------|
| `claude-agents://projects` | List of all projects | — |
| `claude-agents://projects/{encoded-dir}` | Single project with its sessions | `claude-agents://projects/-Users-matt-code-charm` |
| `claude-agents://sessions/{session-id}` | Single session detail | `claude-agents://sessions/a1b2c3d4-...` |
| `claude-agents://status` | Aggregate status summary | — |

Resources support MCP **subscriptions**: a client can subscribe to `claude-agents://projects` and receive notifications when a new project appears or a project's active session count changes. The server detects changes via the same filesystem watchers used by the `watch` command (Milestone 7).

#### MCP Prompts

The server also exposes MCP prompts — pre-built prompt templates that help LLM clients make effective use of the tools:

| Prompt | Description |
|--------|-------------|
| `session_overview` | "Give me a summary of all active Claude Code sessions and what they're working on." |
| `project_history` | "Show me the recent session history for project {project_path}." |
| `find_work` | "Find the session where I was working on {description}." |

---

## Command Interface

```
claude-agents [global-options] <command> [command-options]
```

### Global Options

```
--claude-dir <path>    Path to Claude data directory (default: ~/.claude)
--json                 Output as JSON (default: human-readable table)
--no-color             Disable color output
--verbose              Include additional metadata in output
```

### Commands

#### `projects`

List all known projects, one per line.

```
claude-agents projects [options]
```

| Option | Description |
|--------|-------------|
| `--active` | Only show projects with at least one active session |
| `--sort <field>` | Sort by `path`, `last_active`, `session_count` (default: `path`) |

**Human output:**

```
PROJECT PATH                              SESSIONS  LAST ACTIVE          STATUS
/Users/matt/code/charm                    12        2026-03-28 14:22     ● active
/Users/matt/code/pccd-pipeline            8         2026-03-27 09:15     ○ stopped
/Users/matt/code/agentd                   23        2026-03-28 15:01     ● active
```

**JSON output:**

```json
[
  {
    "path": "/Users/matt/code/charm",
    "encoded_dir": "-Users-matt-code-charm",
    "session_count": 12,
    "last_active": "2026-03-28T14:22:00Z",
    "status": "active",
    "active_sessions": 1
  }
]
```

#### `sessions`

List sessions, optionally filtered by project.

```
claude-agents sessions [options] [project-path]
```

| Option | Description |
|--------|-------------|
| `--active` | Only show active/likely_active sessions |
| `--latest` | Show only the most recent session per project |
| `--limit <n>` | Maximum number of sessions to display (default: 50) |
| `--sort <field>` | Sort by `time`, `project`, `status` (default: `time`) |
| `--since <duration>` | Only sessions active since duration (e.g., `1h`, `7d`) |

**Human output:**

```
SESSION ID                             PROJECT                    BRANCH        STATUS          UPDATED              MSGS
a1b2c3d4-e5f6-7890-abcd-ef1234567890  /Users/matt/code/charm     feat/fhir     ● active        2026-03-28 14:22     42
f9e8d7c6-b5a4-3210-fedc-ba0987654321  /Users/matt/code/charm     main          ○ stopped       2026-03-27 11:05     18
deadbeef-cafe-1234-5678-abcdef012345  /Users/matt/code/agentd    dev           ◎ likely_active  2026-03-28 15:01     7
```

**Example invocations:**

```bash
# All sessions for a specific project
claude-agents sessions /Users/matt/code/charm

# Only active sessions across all projects
claude-agents sessions --active

# Most recent session per project
claude-agents sessions --latest

# Active sessions as JSON (for piping to agentd)
claude-agents sessions --active --json
```

#### `inspect`

Show detailed information about a single session.

```
claude-agents inspect <session-id>
```

**Output:**

```
Session:     a1b2c3d4-e5f6-7890-abcd-ef1234567890
Project:     /Users/matt/code/charm
Branch:      feat/fhir
Status:      ● active (PID 48291)
Created:     2026-03-28 13:45:02
Updated:     2026-03-28 14:22:17
Messages:    42
Summary:     Implementing FHIR R4 patient resource transformer
JSONL Size:  2.3 MB
Sub-agents:  agent-a980ab1, agent-f3c2d1e
```

#### `status`

Quick summary dashboard.

```
claude-agents status
```

**Output:**

```
Claude Code Sessions
━━━━━━━━━━━━━━━━━━━
  Projects:       14
  Total sessions: 187
  Active:         3
  Last 24h:       12

Active Sessions:
  ● /Users/matt/code/charm          feat/fhir     42 msgs   PID 48291
  ● /Users/matt/code/agentd         dev            7 msgs   PID 48305
  ◎ /Users/matt/code/pccd-pipeline  main          15 msgs   (no PID)
```

---

## Data Model

### Internal Types

```typescript
interface Project {
  path: string;                    // Real filesystem path (from sessions-index or history)
  encodedDir: string;              // Folder name under ~/.claude/projects/
  sessions: Session[];
  lastActive: Date;
  status: "active" | "stopped";
}

interface Session {
  id: string;                      // UUID
  projectPath: string;
  branch: string | null;
  summary: string | null;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
  jsonlPath: string;               // Absolute path to the session JSONL file
  jsonlSizeBytes: number;
  status: SessionStatus;
  pid: number | null;              // If active and process found
  subAgents: string[];             // IDs of agent-*.jsonl files
}

type SessionStatus = "active" | "likely_active" | "stopped" | "unknown";

interface HistoryEntry {
  prompt: string;
  timestamp: string;
  cwd: string;
  sessionId: string;
}

interface SessionIndexEntry {
  sessionId: string;
  summary: string;
  messageCount: number;
  gitBranch: string;
  createdAt: string;
  updatedAt: string;
}
```

---

## Implementation Plan

### Technology Choices

| Choice | Rationale |
|--------|-----------|
| **Language: TypeScript (Node.js)** | Claude Code itself is Node/TS. Users already have Node installed. Allows future integration with the Claude Code SDK. |
| **CLI framework: Commander.js** | Lightweight, well-documented, widely used. |
| **MCP server: `@modelcontextprotocol/sdk`** | Official MCP TypeScript SDK. Handles protocol negotiation, stdio/SSE transports, tool/resource/prompt registration. |
| **Output formatting: `chalk` + `cli-table3`** | Standard choices for colored terminal tables. |
| **Filesystem watching: `fs.watch` + `chokidar` fallback** | Native `fs.watch` with `recursive` where supported; `chokidar` for platforms without recursive support. Shared by MCP subscriptions and CLI `--watch`. |
| **Process inspection: `ps` / `/proc`** | Native OS calls, no native module compilation needed. |
| **Package distribution: npm** | Matches Claude Code's own distribution channel. |

### Project Structure

```
claude-agents/
├── src/
│   ├── index.ts                 # Entry point, CLI argument parsing
│   ├── commands/
│   │   ├── projects.ts          # `projects` command
│   │   ├── sessions.ts          # `sessions` command
│   │   ├── inspect.ts           # `inspect` command
│   │   ├── status.ts            # `status` command
│   │   └── serve.ts             # `serve` command (launches MCP server)
│   ├── core/
│   │   ├── scanner.ts           # Reads ~/.claude filesystem, builds Project/Session models
│   │   ├── path-resolver.ts     # Resolves encoded dir names → real paths
│   │   ├── liveness.ts          # Process-table scanning, PID checks, recency heuristics
│   │   ├── history-parser.ts    # Parses history.jsonl
│   │   └── watcher.ts           # Filesystem watcher for change detection (used by MCP subscriptions + CLI --watch)
│   ├── mcp/
│   │   ├── server.ts            # MCP server initialization, transport setup (stdio / SSE)
│   │   ├── tools.ts             # Tool handler registrations (list_projects, list_sessions, etc.)
│   │   ├── resources.ts         # Resource handler registrations (URI routing, subscriptions)
│   │   └── prompts.ts           # MCP prompt templates
│   ├── formatters/
│   │   ├── table.ts             # Human-readable table output
│   │   └── json.ts              # JSON output
│   └── types.ts                 # Shared type definitions
├── test/
│   ├── fixtures/                # Mock ~/.claude directory structures
│   ├── scanner.test.ts
│   ├── path-resolver.test.ts
│   ├── liveness.test.ts
│   ├── mcp/
│   │   ├── tools.test.ts        # MCP tool handler tests
│   │   ├── resources.test.ts    # MCP resource handler tests
│   │   └── integration.test.ts  # End-to-end MCP client ↔ server tests
│   └── commands/
│       ├── projects.test.ts
│       ├── sessions.test.ts
│       └── status.test.ts
├── package.json
├── tsconfig.json
├── README.md
└── DESIGN.md                   # This document
```

---

## Milestones

### Milestone 0 — Scaffolding & Filesystem Discovery

**Goal:** Set up the project, read `~/.claude/projects/` directory structure, and enumerate project folders.

**Deliverables:**
- [x] Project scaffold: `package.json`, `tsconfig.json`, eslint, vitest.
- [x] `scanner.ts` — walks `~/.claude/projects/`, lists encoded directory names.
- [x] `path-resolver.ts` — given an encoded dir, finds and parses `sessions-index.json` to extract the real path. Falls back to `history.jsonl` lookup. Emits a warning if neither works.
- [x] Unit tests with fixture directories (mock `~/.claude/` trees with known paths containing `-` and `.` characters).

**Acceptance criteria:**
- Given a fixture `~/.claude/projects/` directory, the scanner returns all project entries.
- Paths with `.` and `-` in their real names are resolved correctly via `sessions-index.json`.
- Encoded dir names that cannot be resolved are returned with a `path: null` and a warning flag.

**Estimated effort:** 1 day.

---

### Milestone 1 — Session Enumeration

**Goal:** For each project, enumerate all sessions with metadata.

**Deliverables:**
- [x] Extend `scanner.ts` to parse `sessions-index.json` for each project → produce `Session` objects with ID, summary, message count, branch, timestamps.
- [x] Handle the case where `sessions-index.json` is missing (known bug: [anthropics/claude-code#18897](https://github.com/anthropics/claude-code/issues/18897)) — fall back to stat-ing the JSONL files for timestamps and counting lines for message count.
- [x] Parse sub-agent files (`agent-*.jsonl`) and associate them with parent sessions.
- [x] `history-parser.ts` — streaming line-by-line parser for `history.jsonl` (these files can be large). Used as a fallback path resolver and for supplementary timestamp data.
- [x] Unit tests with fixture data including projects with and without `sessions-index.json`.

**Acceptance criteria:**
- All sessions are enumerated even when `sessions-index.json` is absent.
- Session metadata (summary, branch, message count, timestamps) is populated when available.
- Sub-agent sessions are identified and linked to their parent.
- `history.jsonl` parsing handles files > 100 MB without loading into memory.

**Estimated effort:** 1.5 days.

---

### Milestone 2 — Liveness Detection

**Goal:** Determine which sessions have a running Claude Code process attached.

**Deliverables:**
- [x] `liveness.ts` — reads session process registry (`~/.claude/sessions/<PID>.json`), verifies PIDs with `process.kill(pid, 0)`, falls back to JSONL recency heuristic.
- [x] Recency heuristic: stat each session's JSONL file. If `mtime` is within `--recency-window` seconds (default 30), mark `likely_active`.
- [x] Future-proof: check for `.lock` / `.pid` files per session (no-op today, ready for when [#19364](https://github.com/anthropics/claude-code/issues/19364) ships).
- [x] Assign `SessionStatus` to each session.
- [x] Integration tests (with mocked `process.kill` and fixture registry files).

**Acceptance criteria:**
- On Linux, a running `claude` process in `/Users/matt/code/charm` causes that project's sessions to be marked `active`.
- On macOS, same behavior via `lsof`-based detection.
- A session whose JSONL was modified 10 seconds ago but has no matching process is marked `likely_active`.
- A session whose JSONL was modified 2 hours ago with no matching process is marked `stopped`.

**Estimated effort:** 2 days.

---

### Milestone 3 — CLI Commands (`projects`, `sessions`)

**Goal:** Wire up the two primary listing commands with formatted output.

**Deliverables:**
- [x] `commands/projects.ts` — implements `claude-agents projects` with `--active`, `--sort`.
- [x] `commands/sessions.ts` — implements `claude-agents sessions` with `--active`, `--latest`, `--limit`, `--sort`, `--since`, plus optional `[project-path]` filter.
- [x] `formatters/table.ts` — colored table output with status indicators (`●`, `◎`, `○`).
- [x] `formatters/json.ts` — structured JSON output matching the schema in the Data Model section.
- [x] `--json` global flag toggles between formatters.
- [x] `--no-color` disables color (thin ANSI wrapper, no chalk dependency).
- [x] CLI entry point in `cli.ts` with Commander.js setup (separate from library `index.ts`).

**Acceptance criteria:**
- `claude-agents projects` lists all projects with session counts and status.
- `claude-agents projects --active` filters to only projects with active sessions.
- `claude-agents sessions` lists all sessions across all projects.
- `claude-agents sessions /path/to/project` filters to a single project (matching by exact path or substring).
- `claude-agents sessions --latest` shows one session per project (most recently updated).
- `claude-agents sessions --active --json` emits valid JSON to stdout.

**Estimated effort:** 1.5 days.

---

### Milestone 4 — `inspect` and `status` Commands

**Goal:** Add detail-view and dashboard commands.

**Deliverables:**
- [x] `commands/inspect.ts` — takes a session ID (full or prefix), displays detailed metadata including JSONL file size, sub-agents, PID if active.
- [x] `commands/status.ts` — summary dashboard with aggregate counts and a compact active-sessions list.
- [x] Handle ambiguous session ID prefixes (lists matching sessions and exits with an error).

**Acceptance criteria:**
- `claude-agents inspect a1b2c3d4` resolves by prefix and shows full detail.
- `claude-agents inspect` with an ambiguous prefix lists matching sessions and exits with an error.
- `claude-agents status` shows aggregate stats and active session list.

**Estimated effort:** 1 day.

---

### Milestone 5 — MCP Server Foundation & Core Tools

**Goal:** Expose the core query functionality as an MCP server that Claude Code and other MCP clients can connect to.

**Deliverables:**
- [x] Add `@modelcontextprotocol/sdk` dependency.
- [x] `mcp/server.ts` — MCP server initialization with stdio transport. Handles capability negotiation, tool registration, and lifecycle (startup/shutdown).
- [x] `commands/serve.ts` — `claude-agents serve` CLI command that starts the MCP server on stdio. Wires shutdown signals (SIGINT, SIGTERM) to graceful cleanup.
- [x] `mcp/tools.ts` — register the following tool handlers, each calling into existing `core/` modules:
  - `list_projects` — accepts `active_only`, `sort_by`. Returns array of project objects.
  - `list_sessions` — accepts `project_path`, `active_only`, `latest_only`, `limit`, `since`, `sort_by`. Returns array of session objects.
  - `inspect_session` — accepts `session_id` (full or prefix). Returns single session detail object. Returns MCP error if ambiguous or not found.
  - `get_status` — no parameters. Returns aggregate summary (project count, session count, active count, active session list).
  - `find_session` — accepts `query` string and `limit`. Searches session summaries and branch names. Returns matching sessions.
- [x] Input validation with clear MCP error messages (invalid session ID format, unknown sort field, `since` parse failure).
- [x] JSON schemas for all tool inputs and outputs, embedded in the tool registration via Zod schemas so MCP clients can discover parameter shapes.
- [x] Integration test: spin up the MCP server in-process via InMemoryTransport, send tool calls via the MCP client SDK, assert correct responses against fixture data.

**Acceptance criteria:**
- `claude-agents serve` launches and responds to MCP `initialize` handshake.
- A test MCP client can call `list_projects` and receive the same data that `claude-agents projects --json` would produce.
- A test MCP client can call `list_sessions` with `project_path` and `active_only` filters and receive correctly filtered results.
- `inspect_session` with a valid prefix returns the session. With an ambiguous prefix, it returns an error listing matches. With a nonexistent ID, it returns a not-found error.
- `find_session` with query `"FHIR"` returns sessions whose summary or branch contains that string.
- All tool responses conform to their declared JSON schemas.

**Estimated effort:** 2 days.

---

### Milestone 6 — MCP Resources, Subscriptions & Prompts

**Goal:** Add URI-addressable resources with subscription support, SSE transport, and prompt templates — making `claude-agents` a fully-featured MCP server.

**Deliverables:**
- [x] `mcp/resources.ts` — register resource handlers for the following URI patterns:
  - `claude-agents://projects` — returns the full project list as a JSON resource.
  - `claude-agents://projects/{encoded_dir}` — returns a single project with all its sessions.
  - `claude-agents://sessions/{session_id}` — returns a single session detail.
  - `claude-agents://status` — returns the aggregate status summary.
- [x] Resource **list** handler — returns all available resource URIs with human-readable names and descriptions, so MCP clients can browse. Template resources provide list callbacks and completion callbacks.
- [x] `core/watcher.ts` — shared filesystem watcher module using `fs.watch` (with `recursive: true`). Debounces rapid changes (100ms default). Ready for use by MCP subscriptions and CLI `--watch` mode.
- [x] `mcp/prompts.ts` — register MCP prompt templates:
  - `session_overview` — pre-built prompt that references `get_status` tool.
  - `project_history` — accepts `project_path` argument, references `list_sessions` tool.
  - `find_work` — accepts `description` argument, references `find_session` tool.
- [x] SSE transport option: `claude-agents serve --sse --port 3100` starts an HTTP server with StreamableHTTP transport, enabling remote MCP clients to connect over the network.
- [x] `--claude-dir` flag respected in serve mode (passed through to core modules).
- [x] Documentation: MCP server setup instructions in README, including example `.mcp.json` configuration for both stdio and SSE modes.
- [x] Tests:
  - Resource handler unit tests against fixture data (8 tests).
  - SSE transport integration test: HTTP client connects, initializes, calls a tool, receives response (3 tests).
  - Prompt template tests: verify prompt messages are well-formed and reference the correct tools (7 tests).
  - Filesystem watcher tests: debouncing, graceful handling of missing directories (4 tests).

**Acceptance criteria:**
- An MCP client can call `resources/list` and receive all available resource URIs.
- An MCP client can read `claude-agents://projects` and receive the project list.
- An MCP client can read `claude-agents://sessions/a1b2c3d4` and receive session detail.
- A subscribed MCP client receives a notification within 2 seconds of a new session JSONL file being created in the watched directory.
- `claude-agents serve --sse --port 3100` accepts an HTTP connection and serves MCP over SSE.
- An MCP client can call `prompts/list` and receive the three prompt templates with their argument schemas.
- An MCP client can call `prompts/get` for `project_history` with a project path and receive a well-formed prompt message.

**Estimated effort:** 2.5 days.

---

### Milestone 7 — Polish, Packaging, Documentation

**Goal:** Production-ready release covering both CLI and MCP interfaces.

**Deliverables:**
- [x] `README.md` with installation instructions, usage examples, MCP setup guide, and troubleshooting.
- [x] MCP setup guide in README: example `.mcp.json` for stdio, example config for SSE, troubleshooting (server not responding, port conflicts).
- [x] `--help` text for each command, including `serve` with `--sse`/`--port` and `status` with `--watch`/`--interval`.
- [x] npm package configuration: `bin` field, `engines` (Node >= 18), `keywords`, `files`, `license`.
- [x] CI: GitHub Actions for lint, test, build on Linux and macOS (Node 18/20/22). MCP integration tests included in CI.
- [x] Edge cases (18 dedicated tests):
  - Empty `~/.claude/` directory (fresh install) — both CLI and MCP return empty results gracefully.
  - Nonexistent `~/.claude/` directory — all commands return empty without error.
  - Corrupted `sessions-index.json` (graceful skip, falls back to JSONL scan).
  - MCP server handles nonexistent session IDs and empty data with structured error responses, not crashes.
- [x] `--watch` mode for `status` command (re-scan every N seconds, clear and redraw, `--interval` configurable).

**Acceptance criteria:**
- `npm install -g claude-agents` works.
- `claude-agents --help` prints usage for all commands, including `serve`.
- CI passes on both Ubuntu and macOS runners, including MCP integration tests.
- A fresh machine with no `~/.claude/` directory gets a friendly "No Claude Code data found" message (CLI) or an empty-result response (MCP).
- Scan of 200 projects with 1,000 total sessions completes in < 2 seconds.
- README includes a working `.mcp.json` snippet that a user can copy-paste to connect Claude Code to the server.

**Estimated effort:** 2 days.

---

### Milestone 8 — Orchestrator Integration (stretch)

**Goal:** Features specifically for `agentd` and similar orchestration tools.

**Deliverables:**
- [x] `claude-agents watch --json` — streaming NDJSON that emits `snapshot`, `session_started`, `session_stopped`, `status_changed`, `session_updated` events via periodic re-scanning and diffing.
- [x] `claude-agents sessions --format=csv` for spreadsheet/log ingestion. Also supports `--format json` and `--format table`.
- [x] Exit codes: `0` = success, `1` = error, `2` = no matching sessions found (useful for scripting: `claude-agents sessions --active || echo "nothing running"`).
- [x] Shell completions (bash, zsh, fish) via `claude-agents completions <shell>`. Includes dynamic completion of project paths and session IDs.

**Acceptance criteria:**
- `claude-agents watch --json` emits a JSON event within 2 seconds of a new session starting.
- Exit code 2 when `--active` finds no active sessions.
- Shell completions work for project path arguments.

**Estimated effort:** 2 days.

---

### Milestone 9 — Symlinkable Launcher Script

**Goal:** Provide a self-contained launcher script that can be symlinked from `~/bin/` (or anywhere on `$PATH`) to run `claude-agents` via `npx` without a global install.

**Deliverables:**
- [x] `bin/claude-agents` — A shell script (bash) that exec's `npx --yes claude-agents "$@"`, or if the project is local, runs `node <project-dir>/dist/cli.js "$@"` directly.
- [x] The script detects whether it is being run from within the project directory (dev mode) or from a symlink elsewhere (installed mode), and chooses the right invocation accordingly.
- [x] The script is executable (`chmod +x`).
- [x] Documented in README: `ln -s /path/to/claude-agents/bin/claude-agents ~/bin/claude-agents`.

**Acceptance criteria:**
- `ln -s $(pwd)/bin/claude-agents ~/bin/claude-agents && claude-agents status` works from any directory.
- When run from the project directory, it uses the local `dist/cli.js` (no npx overhead).
- When run from a symlink elsewhere, it uses `npx` to fetch and run the package.

**Estimated effort:** 0.5d.

---

### Milestone 10 — Session Deletion (Core + CLI)

**Goal:** Add the ability to delete individual sessions, removing all associated files from `~/.claude/`. This is the first write operation — all prior milestones were read-only.

**Background — Session data locations:**

A session's data is spread across up to 8 filesystem locations:

| # | Location | Description |
|---|----------|-------------|
| 1 | `~/.claude/projects/{encoded}/{sessionId}.jsonl` | Main transcript file |
| 2 | `~/.claude/projects/{encoded}/{sessionId}/` | Session directory (subagents, tool-results) |
| 3 | `~/.claude/projects/{encoded}/sessions-index.json` | Entry in the project's `entries` array |
| 4 | `~/.claude/sessions/{PID}.json` | PID registry file (if session was/is active) |
| 5 | `~/.claude/session-env/{sessionId}/` | Per-session environment data |
| 6 | `~/.claude/file-history/{sessionId}/` | File version snapshots from edits |
| 7 | `~/.claude/debug/{sessionId}.txt` | Debug log (if debug was enabled) |
| 8 | `~/.claude/history.jsonl` | Global history lines referencing this session |

**Deliverables:**
- [x] `core/session-deleter.ts` — Core deletion module:
  - `deleteSession(sessionId, options)` → `DeletionResult` — performs the multi-file cleanup
  - `planSessionDeletion(sessionId, options)` → `DeletionPlan` — dry-run: lists what would be deleted without acting
  - Resolves which project directory a session belongs to (reuses `enumerateAllSessions`)
  - Removes: JSONL transcript, session subdirectory (subagents + tool-results), PID registry entry, session-env dir, file-history dir, debug log
  - Updates `sessions-index.json`: removes the matching entry, preserves the rest. If `entries` becomes empty, removes the file.
  - Does **not** modify `history.jsonl` by default (append-only file; opt-in cleanup deferred to M11)
  - Returns a `DeletionResult` with counts of files/dirs removed and any errors encountered
- [x] Safety checks:
  - Refuse to delete sessions with status `active` (confirmed live PID) unless `--force` is passed
  - Sessions with status `likely_active` get a warning but proceed (PID not confirmed)
  - The `--force` flag bypasses all safety checks
- [x] `commands/delete.ts` — CLI command handler:
  - `claude-agents delete <session-id>` — delete a single session by UUID or prefix
  - `--dry-run` — show what would be deleted without acting
  - `--force` — skip active-session safety check
  - `--json` — output deletion result as JSON
  - Reuses `resolveSessionById()` from `commands/inspect.ts` for prefix resolution
- [x] Wire `delete` command in `cli.ts`
- [x] Types: `DeletionPlan`, `DeletionResult`, `DeletionTarget` in `types.ts`
- [x] Tests (7 tests using temporary directories):
  - Dry-run lists targets without modifying files
  - Warns for active sessions in dry-run
  - Deletes all session artifacts (JSONL, subdirectory, PID registry, session-env, debug log)
  - sessions-index.json correctly updated (entry removed, other entries preserved)
  - Refuses to delete active sessions without --force
  - Deletes active sessions with --force
  - Handles partially missing files gracefully
- [x] Updated `CLAUDE.md` — note that `delete` is the one command that writes to `~/.claude/`

**Acceptance criteria:**
- `claude-agents delete a1b2c3d4 --dry-run` shows all files that would be removed
- `claude-agents delete a1b2c3d4` removes the session's JSONL, subdirectory, sessions-index entry, PID registry, and auxiliary dirs
- `claude-agents delete a1b2c3d4` on an active session exits with error unless `--force` is used
- `sessions-index.json` retains other sessions' entries after deletion
- `claude-agents inspect a1b2c3d4` returns "not found" after deletion

**Estimated effort:** 2d.

---

### Milestone 11 — Session Deletion (MCP + Bulk Operations)

**Goal:** Expose deletion via MCP and add bulk cleanup operations for maintenance workflows.

**Deliverables:**
- [x] `delete_session` MCP tool — accepts `session_id` (full or prefix), `force`, `dry_run` parameters. Returns structured deletion result or plan. Reuses `core/session-deleter.ts`.
- [x] Bulk CLI operations on `delete` command:
  - `--all-stopped` — delete all sessions with status `stopped`
  - `--before <duration>` — only delete sessions last updated before the given duration (e.g., `--before 30d`). Combinable with `--all-stopped`.
  - `--project <path>` — delete all sessions for a specific project (exact or substring match)
  - All bulk operations respect `--dry-run` and `--force`
- [x] `--prune-history` flag — when passed with a delete operation, also removes matching entries from `~/.claude/history.jsonl` (rewrites the file, filtering out lines with the deleted session IDs). Opt-in because it modifies a shared append-only file.
- [x] `bulk_delete_sessions` MCP tool — accepts `all_stopped`, `before`, `project_path`, `force`, `dry_run`, `prune_history`. Returns deletion summary or dry-run list.
- [x] Tests (13 new tests):
  - MCP tool integration tests (delete_session dry-run, delete, error on nonexistent; bulk_delete_sessions dry-run; tool count)
  - Bulk selection with `--all-stopped`, `--before`, `--project`
  - Bulk deletion removes files and returns summary
  - `--prune-history` correctly rewrites history.jsonl (entries removed, others preserved)
  - Missing history file handled gracefully

**Acceptance criteria:**
- MCP client can call `delete_session` and receive a structured result
- `claude-agents delete --all-stopped --before 30d --dry-run` lists all old stopped sessions
- `claude-agents delete --all-stopped --before 30d` removes them (with confirmation)
- `claude-agents delete --project /path --prune-history` cleans up all traces
- Bulk operations show a summary: "Deleted 12 sessions (45 files, 23.4 MB freed)"

**Estimated effort:** 2d.

---

## Milestone Summary

| # | Milestone | Depends On | Effort | Cumulative |
|---|-----------|-----------|--------|------------|
| 0 | Scaffolding & Filesystem Discovery | — | 1d | 1d |
| 1 | Session Enumeration | M0 | 1.5d | 2.5d |
| 2 | Liveness Detection | M0 | 2d | 4.5d |
| 3 | CLI Commands (projects, sessions) | M1, M2 | 1.5d | 6d |
| 4 | inspect & status Commands | M3 | 1d | 7d |
| 5 | MCP Server Foundation & Core Tools | M1, M2 | 2d | 9d |
| 6 | MCP Resources, Subscriptions & Prompts | M5 | 2.5d | 11.5d |
| 7 | Polish, Packaging, Documentation | M4, M6 | 2d | 13.5d |
| 8 | Orchestrator Integration (stretch) | M7 | 2d | 15.5d |
| 9 | Symlinkable Launcher Script | M7 | 0.5d | 16d |
| 10 | Session Deletion (Core + CLI) | M4 | 2d | 18d |
| 11 | Session Deletion (MCP + Bulk) | M5, M10 | 2d | 20d |

Milestones 0–1 and 0–2 can be developed in parallel. Milestones 3–4 (CLI) and 5–6 (MCP) can also be developed in parallel since both depend on M1+M2 and share no code with each other — they are independent adapters over the same core.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Claude Code changes its filesystem layout** | Scanner breaks silently | Version-detect: check for known layout markers. Log warnings on unknown structures. Pin to known Claude Code versions in CI fixtures. |
| **`sessions-index.json` is missing or corrupt** | Path resolution and metadata fail | Fallback chain: index → history.jsonl → encoded dir name. Graceful degradation at every layer. |
| **Process detection is unreliable across platforms** | False negatives for active status | Layer multiple signals (process scan + recency + future lock files). Never claim `stopped` with high confidence — use `unknown` when uncertain. |
| **`history.jsonl` grows unbounded (100 MB+)** | Slow startup, high memory use | Stream-parse with readline. Only read when needed (fallback path resolution). Cache results. |
| **Encoded path collisions** | Two different real paths map to the same folder | Already handled: we never reverse-engineer the folder name. The canonical path comes from `sessions-index.json` or `history.jsonl`. If both sources disagree, warn. |
| **Lock file feature ships with a different schema** | PID check code needs updating | Abstract behind an interface. Check for file existence before parsing. Treat as an additive signal, not a hard dependency. |
| **MCP SDK breaking changes** | Server initialization or transport code breaks | Pin `@modelcontextprotocol/sdk` to a specific minor version. Abstract transport setup behind a factory so swapping implementations is a one-file change. |
| **Recursive `fs.watch` not supported on all platforms** | MCP subscriptions and `--watch` mode silently fail | Detect platform support at startup. Fall back to `chokidar` (polling-based) on unsupported platforms. Log which watcher backend is active. |
| **MCP server invoked by Claude Code creates a recursion concern** | A Claude Code session using the MCP server to inspect itself could cause confusion | The server is read-only and stateless — no risk of mutation loops. Document that the server reports on all sessions including the one that invoked it, which is expected behavior. |
| **SSE transport exposes session data on the network** | Unauthorized access to session metadata | SSE mode binds to `127.0.0.1` by default. Document that `--bind 0.0.0.0` requires the user to manage their own access control. No authentication is built in (matches MCP convention). |

---

## Future Considerations

- **Integration with Claude Code SDK**: Once session listing is available via the TypeScript/Python SDK, `claude-agents` could offer an `--sdk` mode that uses the official API instead of filesystem scraping.
- **Remote machines**: Support `--claude-dir user@host:~/.claude` via SSH for inspecting sessions on remote servers or VMs (relevant for Lima-based sandboxed environments).
- **TUI mode**: A `claude-agents tui` using blessed/ink for an interactive dashboard with session selection and inline `claude --resume` launching.
- **Metrics export**: Prometheus/OpenTelemetry export of session counts, durations, and token usage from `stats-cache.json`.
- **MCP authentication**: If SSE transport is used in shared/team environments, add optional bearer token or mTLS authentication as an MCP server middleware.
- **MCP write tools (opt-in)**: Behind a `--allow-write` flag, expose tools like `archive_session`, `rename_session`, or `rebuild_index` (for the missing `sessions-index.json` problem). These would remain off by default to preserve the read-only guarantee.
- **Multi-machine aggregation**: An MCP server that federates queries across multiple `claude-agents` SSE endpoints — useful for teams running Claude Code across several dev machines or CI workers.
- **MCP sampling integration**: Use MCP sampling to let the server ask the connected LLM to generate richer session summaries from raw JSONL transcripts, improving the `find_session` search quality beyond simple string matching.
