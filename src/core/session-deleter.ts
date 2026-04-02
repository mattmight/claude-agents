import { readFile, writeFile, unlink, rm, stat, readdir } from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import type {
  Session,
  ScannerOptions,
  SessionsIndex,
  DeletionTarget,
  DeletionPlan,
  DeletionResult,
} from "../types.js";
import { enumerateAllSessions } from "./session-enumerator.js";
import { checkAllSessionsLiveness } from "./liveness.js";
import { resolveSessionById } from "../commands/inspect.js";

export interface DeleteSessionOptions extends ScannerOptions {
  /** Skip safety checks for active sessions */
  force?: boolean;
}

/**
 * Find a session by ID/prefix and return it with full context.
 */
async function findSession(
  sessionId: string,
  options: ScannerOptions,
): Promise<Session> {
  const sessions = await enumerateAllSessions(options);
  await checkAllSessionsLiveness(sessions, options);
  return resolveSessionById(sessions, sessionId);
}

/**
 * Compute the base Claude dir.
 */
function getBaseDir(options?: ScannerOptions): string {
  return options?.claudeDir ?? path.join(os.homedir(), ".claude");
}

/**
 * Collect all filesystem targets for a session.
 */
async function collectTargets(
  session: Session,
  options: ScannerOptions,
): Promise<DeletionTarget[]> {
  const targets: DeletionTarget[] = [];
  const baseDir = getBaseDir(options);

  // 1. Main JSONL transcript
  if (session.jsonlPath) {
    const size = await safeStatSize(session.jsonlPath);
    if (size >= 0) {
      targets.push({ path: session.jsonlPath, type: "file", sizeBytes: size });
    }
  }

  // 2. Session subdirectory (subagents, tool-results)
  if (session.jsonlPath) {
    const sessionDir = session.jsonlPath.replace(/\.jsonl$/, "");
    if (await dirExists(sessionDir)) {
      targets.push({ path: sessionDir, type: "directory", sizeBytes: 0 });
    }
  }

  // 3. PID registry files matching this session
  const sessionsDir = path.join(baseDir, "sessions");
  try {
    const entries = await readdir(sessionsDir);
    for (const name of entries) {
      if (!name.endsWith(".json")) continue;
      const filePath = path.join(sessionsDir, name);
      try {
        const raw = await readFile(filePath, "utf-8");
        const data = JSON.parse(raw) as Record<string, unknown>;
        if (data.sessionId === session.id) {
          const size = await safeStatSize(filePath);
          targets.push({ path: filePath, type: "file", sizeBytes: Math.max(0, size) });
        }
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // sessions dir doesn't exist
  }

  // 4. session-env directory
  const sessionEnvDir = path.join(baseDir, "session-env", session.id);
  if (await dirExists(sessionEnvDir)) {
    targets.push({ path: sessionEnvDir, type: "directory", sizeBytes: 0 });
  }

  // 5. file-history directory
  const fileHistoryDir = path.join(baseDir, "file-history", session.id);
  if (await dirExists(fileHistoryDir)) {
    targets.push({ path: fileHistoryDir, type: "directory", sizeBytes: 0 });
  }

  // 6. debug log
  const debugLog = path.join(baseDir, "debug", `${session.id}.txt`);
  const debugSize = await safeStatSize(debugLog);
  if (debugSize >= 0) {
    targets.push({ path: debugLog, type: "file", sizeBytes: debugSize });
  }

  return targets;
}

/**
 * Check if sessions-index.json contains this session.
 */
async function findSessionsIndexPath(
  session: Session,
): Promise<string | null> {
  if (!session.jsonlPath) return null;
  const projectDir = path.dirname(session.jsonlPath);
  const indexPath = path.join(projectDir, "sessions-index.json");
  try {
    const raw = await readFile(indexPath, "utf-8");
    const index = JSON.parse(raw) as Partial<SessionsIndex>;
    if (index.entries?.some((e) => e.sessionId === session.id)) {
      return indexPath;
    }
  } catch {
    // No index or malformed
  }
  return null;
}

/**
 * Plan what a deletion would do without executing it.
 */
export async function planSessionDeletion(
  sessionId: string,
  options: DeleteSessionOptions = {},
): Promise<DeletionPlan> {
  const session = await findSession(sessionId, options);
  const targets = await collectTargets(session, options);
  const indexPath = await findSessionsIndexPath(session);

  let warning: string | null = null;
  if (session.status === "active" && !options.force) {
    warning = `Session ${session.id} is active (PID ${session.pid}). Use --force to delete.`;
  } else if (session.status === "likely_active") {
    warning = `Session ${session.id} may be active (JSONL recently modified).`;
  }

  return {
    sessionId: session.id,
    targets,
    totalBytes: targets.reduce((sum, t) => sum + t.sizeBytes, 0),
    updatesSessionsIndex: indexPath !== null,
    warning,
  };
}

/**
 * Delete a session and all its associated files.
 */
export async function deleteSession(
  sessionId: string,
  options: DeleteSessionOptions = {},
): Promise<DeletionResult> {
  const session = await findSession(sessionId, options);

  // Safety check
  if (session.status === "active" && !options.force) {
    throw new Error(
      `Session ${session.id} is active (PID ${session.pid}). Use --force to delete an active session.`,
    );
  }

  const targets = await collectTargets(session, options);
  const deleted: DeletionTarget[] = [];
  const errors: { path: string; error: string }[] = [];

  // Delete each target
  for (const target of targets) {
    try {
      if (target.type === "directory") {
        await rm(target.path, { recursive: true, force: true });
      } else {
        await unlink(target.path);
      }
      deleted.push(target);
    } catch (err: unknown) {
      errors.push({
        path: target.path,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Update sessions-index.json
  let updatedSessionsIndex = false;
  const indexPath = await findSessionsIndexPath(session);
  if (indexPath) {
    try {
      const raw = await readFile(indexPath, "utf-8");
      const index = JSON.parse(raw) as SessionsIndex;
      const filtered = index.entries.filter(
        (e) => e.sessionId !== session.id,
      );
      if (filtered.length === 0) {
        // Remove the file entirely
        await unlink(indexPath);
      } else {
        index.entries = filtered;
        await writeFile(indexPath, JSON.stringify(index, null, 2) + "\n");
      }
      updatedSessionsIndex = true;
    } catch (err: unknown) {
      errors.push({
        path: indexPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    sessionId: session.id,
    deleted,
    errors,
    updatedSessionsIndex,
    totalBytesFreed: deleted.reduce((sum, t) => sum + t.sizeBytes, 0),
  };
}

export interface BulkDeleteOptions extends DeleteSessionOptions {
  /** Delete all sessions with status "stopped" */
  allStopped?: boolean;
  /** Only delete sessions last updated before this duration (e.g., "30d") */
  before?: string;
  /** Filter to sessions in this project (exact or substring match) */
  projectPath?: string;
  /** Also prune matching entries from history.jsonl */
  pruneHistory?: boolean;
}

export interface BulkDeletionResult {
  results: DeletionResult[];
  totalSessionsDeleted: number;
  totalFilesDeleted: number;
  totalBytesFreed: number;
  totalErrors: number;
  prunedHistoryEntries: number;
}

/**
 * Select sessions matching bulk filters.
 */
export async function selectSessionsForBulkDelete(
  options: BulkDeleteOptions,
): Promise<Session[]> {
  const sessions = await enumerateAllSessions(options);
  await checkAllSessionsLiveness(sessions, options);

  let filtered = [...sessions];

  // Filter: --all-stopped
  if (options.allStopped) {
    filtered = filtered.filter((s) => s.status === "stopped");
  }

  // Filter: --before
  if (options.before) {
    const { parseDuration } = await import("../utils/duration.js");
    const ms = parseDuration(options.before);
    const cutoff = new Date(Date.now() - ms);
    filtered = filtered.filter((s) => s.updatedAt < cutoff);
  }

  // Filter: --project
  if (options.projectPath) {
    const exact = filtered.filter(
      (s) => s.projectPath === options.projectPath,
    );
    if (exact.length > 0) {
      filtered = exact;
    } else {
      const lower = options.projectPath!.toLowerCase();
      filtered = filtered.filter(
        (s) =>
          s.projectPath !== null &&
          s.projectPath.toLowerCase().includes(lower),
      );
    }
  }

  return filtered;
}

/**
 * Delete multiple sessions in bulk.
 */
export async function bulkDeleteSessions(
  options: BulkDeleteOptions,
): Promise<BulkDeletionResult> {
  const sessions = await selectSessionsForBulkDelete(options);

  const results: DeletionResult[] = [];
  const deletedSessionIds = new Set<string>();

  for (const session of sessions) {
    try {
      const result = await deleteSession(session.id, options);
      results.push(result);
      deletedSessionIds.add(session.id);
    } catch {
      // Skip sessions that fail (e.g., active without --force)
    }
  }

  let prunedHistoryEntries = 0;
  if (options.pruneHistory && deletedSessionIds.size > 0) {
    prunedHistoryEntries = await pruneHistoryFile(
      deletedSessionIds,
      options,
    );
  }

  return {
    results,
    totalSessionsDeleted: results.length,
    totalFilesDeleted: results.reduce((sum, r) => sum + r.deleted.length, 0),
    totalBytesFreed: results.reduce((sum, r) => sum + r.totalBytesFreed, 0),
    totalErrors: results.reduce((sum, r) => sum + r.errors.length, 0),
    prunedHistoryEntries,
  };
}

/**
 * Remove entries from history.jsonl that reference any of the given session IDs.
 * Rewrites the file in place. Returns the number of entries removed.
 */
export async function pruneHistoryFile(
  sessionIds: Set<string>,
  options?: ScannerOptions,
): Promise<number> {
  const baseDir = getBaseDir(options);
  const historyPath = path.join(baseDir, "history.jsonl");

  let lines: string[];
  try {
    const raw = await readFile(historyPath, "utf-8");
    lines = raw.split("\n");
  } catch {
    return 0; // File doesn't exist
  }

  let removed = 0;
  const kept: string[] = [];

  for (const line of lines) {
    if (!line.trim()) {
      kept.push(line);
      continue;
    }
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      if (
        typeof entry.sessionId === "string" &&
        sessionIds.has(entry.sessionId)
      ) {
        removed++;
        continue;
      }
    } catch {
      // Keep malformed lines
    }
    kept.push(line);
  }

  if (removed > 0) {
    await writeFile(historyPath, kept.join("\n"));
  }

  return removed;
}

async function safeStatSize(filePath: string): Promise<number> {
  try {
    const s = await stat(filePath);
    return s.size;
  } catch {
    return -1;
  }
}

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const s = await stat(dirPath);
    return s.isDirectory();
  } catch {
    return false;
  }
}
