import type { Session, ScannerOptions } from "../types.js";
import { enumerateAllSessions } from "../core/session-enumerator.js";
import { checkAllSessionsLiveness } from "../core/liveness.js";

export interface WatchCommandOptions {
  claudeDir?: string;
  interval?: number;
}

interface SessionSnapshot {
  status: string;
  updatedAt: number;
}

function sessionToJson(s: Session) {
  return {
    id: s.id,
    project_path: s.projectPath,
    branch: s.branch,
    status: s.status ?? "unknown",
    updated_at: s.updatedAt.toISOString(),
    created_at: s.createdAt.toISOString(),
    message_count: s.messageCount,
    summary: s.summary,
    pid: s.pid,
  };
}

function emit(event: string, data: Record<string, unknown>) {
  const line = JSON.stringify({ event, timestamp: new Date().toISOString(), ...data });
  process.stdout.write(line + "\n");
}

/**
 * Perform a full scan and return sessions with liveness.
 */
export async function scanSessions(
  scannerOptions: ScannerOptions,
): Promise<Session[]> {
  const sessions = await enumerateAllSessions(scannerOptions);
  await checkAllSessionsLiveness(sessions, scannerOptions);
  return sessions;
}

/**
 * Diff current sessions against previous snapshot and emit events.
 * Returns updated snapshot map.
 */
export function diffAndEmit(
  sessions: Session[],
  prev: Map<string, SessionSnapshot>,
): Map<string, SessionSnapshot> {
  const next = new Map<string, SessionSnapshot>();

  for (const s of sessions) {
    const status = s.status ?? "unknown";
    const updatedAt = s.updatedAt.getTime();
    next.set(s.id, { status, updatedAt });

    const old = prev.get(s.id);
    if (!old) {
      emit("session_started", { session: sessionToJson(s) });
    } else if (old.status !== status) {
      emit("status_changed", {
        session: sessionToJson(s),
        previous_status: old.status,
      });
    } else if (old.updatedAt !== updatedAt) {
      emit("session_updated", { session: sessionToJson(s) });
    }
  }

  // Check for sessions that disappeared (stopped)
  for (const [id, old] of prev) {
    if (!next.has(id)) {
      emit("session_stopped", {
        session: { id, previous_status: old.status },
      });
    }
  }

  return next;
}

export async function runWatchCommand(
  options: WatchCommandOptions,
): Promise<void> {
  const scannerOptions: ScannerOptions = {};
  if (options.claudeDir) scannerOptions.claudeDir = options.claudeDir;
  const interval = options.interval ?? 5;

  // Initial snapshot
  const sessions = await scanSessions(scannerOptions);
  emit("snapshot", { sessions: sessions.map(sessionToJson) });

  // Build initial state
  let prev = new Map<string, SessionSnapshot>();
  for (const s of sessions) {
    prev.set(s.id, {
      status: s.status ?? "unknown",
      updatedAt: s.updatedAt.getTime(),
    });
  }

  // Periodic re-scan
  const timer = setInterval(async () => {
    try {
      const current = await scanSessions(scannerOptions);
      prev = diffAndEmit(current, prev);
    } catch {
      // Scan failures are transient — skip this cycle
    }
  }, interval * 1000);

  const cleanup = () => {
    clearInterval(timer);
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Keep alive
  await new Promise(() => {});
}
