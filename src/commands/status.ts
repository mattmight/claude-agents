import type { Session, ScannerOptions } from "../types.js";
import type { ColorFunctions } from "../utils/colors.js";
import { formatStatusDashboard, formatStatusJson } from "../formatters/status.js";
import { enumerateAllSessions } from "../core/session-enumerator.js";
import { checkAllSessionsLiveness } from "../core/liveness.js";
import { scanProjectDirs } from "../core/scanner.js";

export interface StatusCommandOptions {
  json?: boolean;
  verbose?: boolean;
  claudeDir?: string;
  watch?: boolean;
  watchInterval?: number;
}

export interface StatusData {
  projectCount: number;
  totalSessions: number;
  activeSessions: number;
  last24hSessions: number;
  activeSessionList: Session[];
}

export async function buildStatusData(
  scannerOptions: ScannerOptions,
): Promise<StatusData> {
  const encodedDirs = await scanProjectDirs(scannerOptions);
  const sessions = await enumerateAllSessions(scannerOptions);
  await checkAllSessionsLiveness(sessions, scannerOptions);

  const activeSessions = sessions.filter(
    (s) => s.status === "active" || s.status === "likely_active",
  );

  const oneDayAgo = new Date(Date.now() - 86_400_000);
  const last24hSessions = sessions.filter((s) => s.updatedAt >= oneDayAgo);

  // Sort active sessions by updatedAt descending
  activeSessions.sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  );

  return {
    projectCount: encodedDirs.length,
    totalSessions: sessions.length,
    activeSessions: activeSessions.length,
    last24hSessions: last24hSessions.length,
    activeSessionList: activeSessions,
  };
}

export async function runStatusCommand(
  options: StatusCommandOptions,
  colors: ColorFunctions,
): Promise<string> {
  const scannerOptions: ScannerOptions = {};
  if (options.claudeDir) scannerOptions.claudeDir = options.claudeDir;

  const data = await buildStatusData(scannerOptions);

  if (options.json) {
    return formatStatusJson(data);
  }
  return formatStatusDashboard(data, colors);
}

/**
 * Run the status command in watch mode, re-scanning and redrawing on an interval.
 * This function never returns (runs until process exits).
 */
export async function runStatusWatch(
  options: StatusCommandOptions,
  colors: ColorFunctions,
): Promise<void> {
  const interval = options.watchInterval ?? 5;

  const render = async () => {
    const output = await runStatusCommand(
      { ...options, watch: false },
      colors,
    );
    // Clear screen and move cursor to top
    process.stdout.write("\x1b[2J\x1b[H");
    process.stdout.write(output + "\n\n");
    process.stdout.write(
      colors.dim(`Refreshing every ${interval}s — press Ctrl+C to stop\n`),
    );
  };

  await render();
  const timer = setInterval(render, interval * 1000);

  const cleanup = () => {
    clearInterval(timer);
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Keep alive
  await new Promise(() => {});
}
