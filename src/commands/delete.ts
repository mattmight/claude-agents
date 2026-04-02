import type { ScannerOptions, DeletionPlan, DeletionResult } from "../types.js";
import type { ColorFunctions } from "../utils/colors.js";
import {
  planSessionDeletion,
  deleteSession,
  selectSessionsForBulkDelete,
  bulkDeleteSessions,
} from "../core/session-deleter.js";
import type { BulkDeletionResult } from "../core/session-deleter.js";

export interface DeleteCommandOptions {
  dryRun?: boolean;
  force?: boolean;
  json?: boolean;
  claudeDir?: string;
  allStopped?: boolean;
  before?: string;
  project?: string;
  pruneHistory?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const k = 1024;
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(k)),
    units.length - 1,
  );
  const value = bytes / Math.pow(k, i);
  return i === 0 ? `${bytes} B` : `${value.toFixed(1)} ${units[i]}`;
}

function formatPlanText(plan: DeletionPlan, colors: ColorFunctions): string {
  const lines: string[] = [];

  if (plan.warning) {
    lines.push(colors.yellow(`Warning: ${plan.warning}`));
    lines.push("");
  }

  lines.push(
    colors.bold(`Dry run — would delete session ${plan.sessionId}:`),
  );
  lines.push("");

  for (const target of plan.targets) {
    const icon = target.type === "directory" ? "dir " : "file";
    const size =
      target.sizeBytes > 0 ? ` (${formatBytes(target.sizeBytes)})` : "";
    lines.push(`  ${colors.dim(icon)}  ${target.path}${size}`);
  }

  if (plan.updatesSessionsIndex) {
    lines.push(
      `  ${colors.dim("edit")}  sessions-index.json (remove entry)`,
    );
  }

  lines.push("");
  lines.push(
    `Total: ${plan.targets.length} targets, ${formatBytes(plan.totalBytes)}`,
  );

  return lines.join("\n");
}

function formatResultText(
  result: DeletionResult,
  colors: ColorFunctions,
): string {
  const lines: string[] = [];

  lines.push(colors.bold(`Deleted session ${result.sessionId}`));
  lines.push("");

  for (const target of result.deleted) {
    lines.push(`  ${colors.green("\u2713")} ${target.path}`);
  }

  if (result.updatedSessionsIndex) {
    lines.push(`  ${colors.green("\u2713")} sessions-index.json updated`);
  }

  for (const err of result.errors) {
    lines.push(`  ${colors.red("\u2717")} ${err.path}: ${err.error}`);
  }

  lines.push("");
  lines.push(
    `Freed ${formatBytes(result.totalBytesFreed)} (${result.deleted.length} items removed${result.errors.length > 0 ? `, ${result.errors.length} errors` : ""})`,
  );

  return lines.join("\n");
}

function formatBulkResultText(
  result: BulkDeletionResult,
  colors: ColorFunctions,
): string {
  const lines: string[] = [];

  lines.push(
    colors.bold(
      `Deleted ${result.totalSessionsDeleted} sessions (${result.totalFilesDeleted} files, ${formatBytes(result.totalBytesFreed)} freed)`,
    ),
  );

  if (result.prunedHistoryEntries > 0) {
    lines.push(
      `Pruned ${result.prunedHistoryEntries} entries from history.jsonl`,
    );
  }

  if (result.totalErrors > 0) {
    lines.push(colors.red(`${result.totalErrors} errors encountered`));
  }

  return lines.join("\n");
}

function isBulkOperation(options: DeleteCommandOptions): boolean {
  return !!(options.allStopped || options.before || options.project);
}

export async function runDeleteCommand(
  sessionId: string | undefined,
  options: DeleteCommandOptions,
  colors: ColorFunctions,
): Promise<string> {
  const scannerOptions: ScannerOptions = {};
  if (options.claudeDir) scannerOptions.claudeDir = options.claudeDir;

  // Bulk operation
  if (isBulkOperation(options)) {
    const bulkOptions = {
      ...scannerOptions,
      force: options.force,
      allStopped: options.allStopped,
      before: options.before,
      projectPath: options.project,
      pruneHistory: options.pruneHistory,
    };

    if (options.dryRun) {
      const sessions = await selectSessionsForBulkDelete(bulkOptions);
      if (sessions.length === 0) {
        return "No sessions match the given filters.";
      }

      const lines = [
        colors.bold(
          `Dry run — would delete ${sessions.length} sessions:`,
        ),
        "",
      ];
      for (const s of sessions) {
        lines.push(
          `  ${s.id}  ${s.projectPath ?? "(unknown)"}  ${s.status ?? "unknown"}  ${s.updatedAt.toISOString()}`,
        );
      }
      if (options.pruneHistory) {
        lines.push("");
        lines.push("Would also prune matching entries from history.jsonl");
      }

      if (options.json) {
        return JSON.stringify(
          {
            sessions: sessions.map((s) => ({
              id: s.id,
              project_path: s.projectPath,
              status: s.status,
              updated_at: s.updatedAt.toISOString(),
            })),
            count: sessions.length,
            prune_history: options.pruneHistory ?? false,
          },
          null,
          2,
        );
      }
      return lines.join("\n");
    }

    const result = await bulkDeleteSessions(bulkOptions);

    if (options.json) {
      return JSON.stringify(
        {
          total_sessions_deleted: result.totalSessionsDeleted,
          total_files_deleted: result.totalFilesDeleted,
          total_bytes_freed: result.totalBytesFreed,
          total_errors: result.totalErrors,
          pruned_history_entries: result.prunedHistoryEntries,
        },
        null,
        2,
      );
    }
    return formatBulkResultText(result, colors);
  }

  // Single session operation
  if (!sessionId) {
    throw new Error(
      "Specify a session ID or use --all-stopped, --before, or --project for bulk operations.",
    );
  }

  if (options.dryRun) {
    const plan = await planSessionDeletion(sessionId, {
      ...scannerOptions,
      force: options.force,
    });

    if (
      plan.warning &&
      !options.force &&
      plan.warning.includes("is active")
    ) {
      throw new Error(plan.warning);
    }

    if (options.json) {
      return JSON.stringify(plan, null, 2);
    }
    return formatPlanText(plan, colors);
  }

  const result = await deleteSession(sessionId, {
    ...scannerOptions,
    force: options.force,
  });

  if (options.json) {
    return JSON.stringify(result, null, 2);
  }
  return formatResultText(result, colors);
}
