import type { ScannerOptions } from "../types.js";
import type { ColorFunctions } from "../utils/colors.js";
import type { ProjectRow } from "../formatters/table.js";
import { formatProjectsTable } from "../formatters/table.js";
import { formatProjectsJson } from "../formatters/json.js";
import { scanProjectDirs } from "../core/scanner.js";
import { resolveAllProjects } from "../core/path-resolver.js";
import { enumerateProjectSessions } from "../core/session-enumerator.js";
import { checkAllSessionsLiveness } from "../core/liveness.js";
import { getProjectsDir } from "../core/scanner.js";
import * as path from "node:path";

export interface ProjectsCommandOptions {
  active?: boolean;
  sort?: "path" | "last_active" | "session_count";
  json?: boolean;
  verbose?: boolean;
  claudeDir?: string;
}

export interface CommandResult {
  output: string;
  isEmpty: boolean;
}

export async function runProjectsCommand(
  options: ProjectsCommandOptions,
  colors: ColorFunctions,
): Promise<CommandResult> {
  const scannerOptions: ScannerOptions = {};
  if (options.claudeDir) scannerOptions.claudeDir = options.claudeDir;

  let rows = await buildProjectRows(scannerOptions);

  // Filter
  if (options.active) {
    rows = rows.filter((r) => r.status === "active");
  }

  // Sort
  const sortField = options.sort ?? "path";
  switch (sortField) {
    case "path":
      rows.sort((a, b) => a.path.localeCompare(b.path));
      break;
    case "last_active":
      rows.sort(
        (a, b) =>
          (b.lastActive?.getTime() ?? 0) - (a.lastActive?.getTime() ?? 0),
      );
      break;
    case "session_count":
      rows.sort((a, b) => b.sessionCount - a.sessionCount);
      break;
  }

  const isEmpty = rows.length === 0;

  let output: string;
  if (options.json) {
    output = formatProjectsJson(rows);
  } else {
    output = formatProjectsTable(rows, colors);
  }

  return { output, isEmpty };
}

export async function buildProjectRows(
  scannerOptions: ScannerOptions,
): Promise<ProjectRow[]> {
  const encodedDirs = await scanProjectDirs(scannerOptions);
  if (encodedDirs.length === 0) return [];

  const projects = await resolveAllProjects(encodedDirs, scannerOptions);
  const projectsDir = getProjectsDir(scannerOptions);

  // Enumerate and check liveness for all projects in parallel
  const projectRows: ProjectRow[] = [];

  await Promise.all(
    projects.map(async (project) => {
      const dirPath = path.join(projectsDir, project.encodedDir);
      const sessions = await enumerateProjectSessions(
        dirPath,
        project.realPath,
      );
      await checkAllSessionsLiveness(sessions, scannerOptions);

      const sessionCount = sessions.length;
      const activeSessionCount = sessions.filter(
        (s) => s.status === "active" || s.status === "likely_active",
      ).length;
      const lastActive =
        sessions.length > 0
          ? new Date(
              Math.max(...sessions.map((s) => s.updatedAt.getTime())),
            )
          : null;
      const status: "active" | "stopped" =
        activeSessionCount > 0 ? "active" : "stopped";

      projectRows.push({
        path: project.realPath ?? project.encodedDir,
        encodedDir: project.encodedDir,
        sessionCount,
        lastActive,
        status,
        activeSessionCount,
      });
    }),
  );

  return projectRows;
}
