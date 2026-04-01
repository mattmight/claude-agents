import type { Session, ScannerOptions, SessionStatus } from "../types.js";
import type { ColorFunctions } from "../utils/colors.js";
import { formatSessionsTable } from "../formatters/table.js";
import { formatSessionsJson } from "../formatters/json.js";
import { formatSessionsCsv } from "../formatters/csv.js";
import { enumerateAllSessions } from "../core/session-enumerator.js";
import { checkAllSessionsLiveness } from "../core/liveness.js";
import { parseDuration } from "../utils/duration.js";

export interface SessionsCommandOptions {
  active?: boolean;
  latest?: boolean;
  limit?: number;
  sort?: "time" | "project" | "status";
  since?: string;
  json?: boolean;
  format?: "table" | "json" | "csv";
  verbose?: boolean;
  claudeDir?: string;
}

export interface CommandResult {
  output: string;
  isEmpty: boolean;
}

const STATUS_PRIORITY: Record<string, number> = {
  active: 0,
  likely_active: 1,
  stopped: 2,
  unknown: 3,
};

export async function runSessionsCommand(
  projectPath: string | undefined,
  options: SessionsCommandOptions,
  colors: ColorFunctions,
): Promise<CommandResult> {
  const scannerOptions: ScannerOptions = {};
  if (options.claudeDir) scannerOptions.claudeDir = options.claudeDir;

  let sessions = await enumerateAllSessions(scannerOptions);
  await checkAllSessionsLiveness(sessions, scannerOptions);

  // Filter: project path (exact match, then substring)
  if (projectPath) {
    const exact = sessions.filter((s) => s.projectPath === projectPath);
    if (exact.length > 0) {
      sessions = exact;
    } else {
      const lower = projectPath.toLowerCase();
      sessions = sessions.filter(
        (s) =>
          s.projectPath !== null &&
          s.projectPath.toLowerCase().includes(lower),
      );
    }
  }

  // Filter: --since
  if (options.since) {
    const ms = parseDuration(options.since);
    const cutoff = new Date(Date.now() - ms);
    sessions = sessions.filter((s) => s.updatedAt >= cutoff);
  }

  // Filter: --active
  if (options.active) {
    sessions = sessions.filter(
      (s) => s.status === "active" || s.status === "likely_active",
    );
  }

  // Filter: --latest (one per project, most recent)
  if (options.latest) {
    const byProject = new Map<string, Session>();
    for (const s of sessions) {
      const key = s.projectPath ?? s.id;
      const existing = byProject.get(key);
      if (!existing || s.updatedAt > existing.updatedAt) {
        byProject.set(key, s);
      }
    }
    sessions = Array.from(byProject.values());
  }

  // Sort
  const sortField = options.sort ?? "time";
  switch (sortField) {
    case "time":
      sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      break;
    case "project":
      sessions.sort((a, b) => {
        const cmp = (a.projectPath ?? "").localeCompare(
          b.projectPath ?? "",
        );
        if (cmp !== 0) return cmp;
        return b.updatedAt.getTime() - a.updatedAt.getTime();
      });
      break;
    case "status":
      sessions.sort((a, b) => {
        const aPri = STATUS_PRIORITY[a.status as SessionStatus] ?? 3;
        const bPri = STATUS_PRIORITY[b.status as SessionStatus] ?? 3;
        if (aPri !== bPri) return aPri - bPri;
        return b.updatedAt.getTime() - a.updatedAt.getTime();
      });
      break;
  }

  // Limit
  const limit = options.limit ?? 50;
  sessions = sessions.slice(0, limit);

  const isEmpty = sessions.length === 0;

  // Determine format: explicit --format takes priority, then --json flag
  const format = options.format ?? (options.json ? "json" : "table");

  let output: string;
  switch (format) {
    case "json":
      output = formatSessionsJson(sessions);
      break;
    case "csv":
      output = formatSessionsCsv(sessions);
      break;
    default:
      output = formatSessionsTable(sessions, colors);
      break;
  }

  return { output, isEmpty };
}
