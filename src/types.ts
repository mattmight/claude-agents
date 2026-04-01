/**
 * A discovered project directory under ~/.claude/projects/.
 */
export interface ProjectEntry {
  /** The encoded directory name (e.g., "-Users-alice-projects-my-app") */
  encodedDir: string;

  /** The absolute path to the encoded directory on disk */
  dirPath: string;

  /** The resolved real filesystem path, or null if resolution failed */
  realPath: string | null;

  /** How the real path was resolved */
  resolvedVia: "sessions-index" | "history" | null;

  /** True if path could not be resolved */
  warning: boolean;
}

/**
 * The top-level structure of sessions-index.json.
 * Field names match the on-disk format exactly.
 */
export interface SessionsIndex {
  version: number;
  entries: SessionsIndexEntry[];
  originalPath: string;
}

/**
 * A single entry in sessions-index.json.
 */
export interface SessionsIndexEntry {
  sessionId: string;
  fullPath: string;
  fileMtime: number;
  firstPrompt: string;
  summary: string;
  messageCount: number;
  created: string;
  modified: string;
  gitBranch: string;
  projectPath: string;
  isSidechain: boolean;
}

/**
 * A single line from ~/.claude/history.jsonl.
 * Field names match the on-disk format (display, not prompt; project, not cwd).
 */
export interface HistoryEntry {
  display: string;
  pastedContents: Record<string, unknown>;
  timestamp: number;
  project: string;
  sessionId: string;
}

/**
 * Options for scanner and path-resolver functions.
 */
export interface ScannerOptions {
  /** Override the default ~/.claude base directory */
  claudeDir?: string;
}

/**
 * A single session within a project.
 */
export interface Session {
  /** Session UUID */
  id: string;

  /** Real filesystem path of the project, or null if unresolved */
  projectPath: string | null;

  /** Git branch, or null if unavailable */
  branch: string | null;

  /** Auto-generated summary, or null if unavailable */
  summary: string | null;

  /** First user prompt, or null if unavailable */
  firstPrompt: string | null;

  /** Number of messages (user + assistant + system entries) */
  messageCount: number;

  /** When the session was created */
  createdAt: Date;

  /** When the session was last modified */
  updatedAt: Date;

  /** Absolute path to the session JSONL file, or null if not on disk */
  jsonlPath: string | null;

  /** Size of the JSONL file in bytes, or 0 if not on disk */
  jsonlSizeBytes: number;

  /** Whether this is a sidechain session */
  isSidechain: boolean;

  /** Sub-agents associated with this session */
  subAgents: SubAgent[];

  /** How the session metadata was obtained */
  source: "sessions-index" | "jsonl-scan";

  /** Liveness status — undefined until a liveness check is performed */
  status: SessionStatus | undefined;

  /** PID of the process owning this session, or null if unknown/dead */
  pid: number | null;
}

/**
 * A discovered sub-agent associated with a parent session.
 */
export interface SubAgent {
  /** The agent identifier (hash portion of agent-<hash>.jsonl) */
  agentId: string;

  /** Absolute path to the agent JSONL file */
  jsonlPath: string;

  /** Agent type from .meta.json, or null if absent */
  agentType: string | null;

  /** Description from .meta.json, or null if absent */
  description: string | null;
}

/**
 * Metadata from a sub-agent's .meta.json file.
 */
export interface SubAgentMeta {
  agentType: string;
  description?: string;
}

/**
 * History entries grouped by session.
 */
export interface HistorySessionData {
  sessionId: string;
  project: string;
  firstTimestamp: number;
  lastTimestamp: number;
  promptCount: number;
}

/**
 * Liveness status of a session.
 */
export type SessionStatus = "active" | "likely_active" | "stopped" | "unknown";

/**
 * An entry from the Claude Code session process registry
 * (~/.claude/sessions/<PID>.json).
 */
export interface SessionRegistryEntry {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: string | number;
}

/**
 * Result of a liveness check on a single session.
 */
export interface LivenessResult {
  status: SessionStatus;
  pid: number | null;
}

/**
 * Options for liveness detection functions.
 */
export interface LivenessOptions extends ScannerOptions {
  /** Seconds within which a JSONL mtime is considered "recent" (default 30) */
  recencyWindowSeconds?: number;
}
