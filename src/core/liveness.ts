import { readFile, readdir, stat } from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import type {
  Session,
  SessionRegistryEntry,
  LivenessResult,
  LivenessOptions,
} from "../types.js";

const DEFAULT_RECENCY_WINDOW_SECONDS = 30;

/**
 * Return the path to the Claude Code session process registry directory.
 */
export function getSessionsDir(options?: { claudeDir?: string }): string {
  const base = options?.claudeDir ?? path.join(os.homedir(), ".claude");
  return path.join(base, "sessions");
}

/**
 * Check liveness for a single session.
 *
 * 1. Look up session in the process registry (PID files under ~/.claude/sessions/).
 * 2. If found, verify the PID is alive via process.kill(pid, 0).
 * 3. Fall back to JSONL mtime recency heuristic.
 */
export async function checkSessionLiveness(
  session: Session,
  options?: LivenessOptions,
): Promise<LivenessResult> {
  const registry = await readSessionRegistry(options);
  return checkSessionLivenessWithRegistry(session, registry, options);
}

/**
 * Check liveness for all sessions in batch.
 * Reads the registry once and applies it to every session.
 * Mutates sessions in place (sets status and pid).
 * Returns the same array reference.
 */
export async function checkAllSessionsLiveness(
  sessions: Session[],
  options?: LivenessOptions,
): Promise<Session[]> {
  const registry = await readSessionRegistry(options);

  await Promise.all(
    sessions.map(async (session) => {
      const result = await checkSessionLivenessWithRegistry(
        session,
        registry,
        options,
      );
      session.status = result.status;
      session.pid = result.pid;
    }),
  );

  return sessions;
}

/**
 * Internal: check liveness using a pre-loaded registry map.
 */
async function checkSessionLivenessWithRegistry(
  session: Session,
  registry: Map<string, SessionRegistryEntry>,
  options?: LivenessOptions,
): Promise<LivenessResult> {
  const windowSeconds =
    options?.recencyWindowSeconds ?? DEFAULT_RECENCY_WINDOW_SECONDS;

  // Step 1: Check process registry
  const entry = registry.get(session.id);
  if (entry) {
    if (isProcessAlive(entry.pid)) {
      return { status: "active", pid: entry.pid };
    }
    // PID is dead — fall through to recency check
  }

  // Step 2: Check lock/pid file (placeholder for future use)
  const lockResult = checkLockOrPidFile(session.id, "");
  if (lockResult !== null) {
    return lockResult;
  }

  // Step 3: JSONL recency heuristic
  if (session.jsonlPath) {
    const recent = await checkJsonlRecency(session.jsonlPath, windowSeconds);
    if (recent) {
      return { status: "likely_active", pid: entry?.pid ?? null };
    }
    return { status: "stopped", pid: null };
  }

  // No registry entry, no JSONL path
  return { status: "unknown", pid: null };
}

/**
 * Read all session process registry files from ~/.claude/sessions/*.json.
 * Returns a Map from sessionId to the registry entry.
 * Skips malformed files and files missing required fields.
 */
async function readSessionRegistry(
  options?: LivenessOptions,
): Promise<Map<string, SessionRegistryEntry>> {
  const sessionsDir = getSessionsDir(options);
  const registry = new Map<string, SessionRegistryEntry>();

  let entries: string[];
  try {
    entries = await readdir(sessionsDir);
  } catch {
    // Directory doesn't exist — return empty registry
    return registry;
  }

  await Promise.all(
    entries
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => {
        const filePath = path.join(sessionsDir, name);
        try {
          const raw = await readFile(filePath, "utf-8");
          const data = JSON.parse(raw) as Partial<SessionRegistryEntry>;

          // Validate required fields
          if (
            typeof data.pid !== "number" ||
            typeof data.sessionId !== "string" ||
            typeof data.cwd !== "string" ||
            (typeof data.startedAt !== "string" &&
              typeof data.startedAt !== "number")
          ) {
            return; // Skip malformed entry
          }

          registry.set(data.sessionId, data as SessionRegistryEntry);
        } catch {
          // Skip malformed JSON or read errors
        }
      }),
  );

  return registry;
}

/**
 * Check if a process is alive using kill(pid, 0).
 * Returns true if the process exists (even if we lack permission to signal it).
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "EPERM"
    ) {
      // Process exists but we lack permission to signal it
      return true;
    }
    // ESRCH or other error — process is dead
    return false;
  }
}

/**
 * Check whether a JSONL file was modified within the given recency window.
 */
async function checkJsonlRecency(
  jsonlPath: string,
  windowSeconds: number,
): Promise<boolean> {
  try {
    const fileStat = await stat(jsonlPath);
    const ageSeconds = (Date.now() - fileStat.mtimeMs) / 1000;
    return ageSeconds <= windowSeconds;
  } catch {
    // File doesn't exist or can't be stat'd
    return false;
  }
}

/**
 * Placeholder for future lock/PID file support.
 * See: https://github.com/anthropics/claude-code/issues/19364
 * Always returns null (no lock file found).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function checkLockOrPidFile(sessionId: string, dirPath: string): LivenessResult | null {
  return null;
}
