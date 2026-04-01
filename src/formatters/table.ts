import type { Session, SessionStatus } from "../types.js";
import type { ColorFunctions } from "../utils/colors.js";

export interface ProjectRow {
  path: string;
  encodedDir: string;
  sessionCount: number;
  lastActive: Date | null;
  status: "active" | "stopped";
  activeSessionCount: number;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function statusIndicator(
  status: SessionStatus | undefined,
  colors: ColorFunctions,
): string {
  switch (status) {
    case "active":
      return colors.green("\u25CF active");
    case "likely_active":
      return colors.yellow("\u25CE likely_active");
    case "stopped":
      return colors.dim("\u25CB stopped");
    default:
      return colors.dim("? unknown");
  }
}

function projectStatusIndicator(
  status: "active" | "stopped",
  colors: ColorFunctions,
): string {
  if (status === "active") return colors.green("\u25CF active");
  return colors.dim("\u25CB stopped");
}

export function formatProjectsTable(
  projects: ProjectRow[],
  colors: ColorFunctions,
): string {
  if (projects.length === 0) {
    return "No projects found.";
  }

  const headers = ["PROJECT PATH", "SESSIONS", "LAST ACTIVE", "STATUS"];
  const rows = projects.map((p) => [
    p.path,
    String(p.sessionCount),
    p.lastActive ? formatDate(p.lastActive) : "-",
    projectStatusIndicator(p.status, colors),
  ]);

  return renderTable(headers, rows, colors);
}

export function formatSessionsTable(
  sessions: Session[],
  colors: ColorFunctions,
): string {
  if (sessions.length === 0) {
    return "No sessions found.";
  }

  const headers = [
    "SESSION ID",
    "PROJECT",
    "BRANCH",
    "STATUS",
    "UPDATED",
    "MSGS",
    "PID",
  ];
  const rows = sessions.map((s) => [
    s.id,
    s.projectPath ?? "(unknown)",
    s.branch ?? "",
    statusIndicator(s.status, colors),
    formatDate(s.updatedAt),
    String(s.messageCount),
    s.pid !== null ? String(s.pid) : "",
  ]);

  return renderTable(headers, rows, colors);
}

/** Strip ANSI escape codes for width measurement. */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function renderTable(
  headers: string[],
  rows: string[][],
  colors: ColorFunctions,
): string {
  // Compute column widths from plain text
  const widths = headers.map((h) => h.length);
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      const plainLen = stripAnsi(row[i]).length;
      if (plainLen > widths[i]) widths[i] = plainLen;
    }
  }

  const gap = 2;
  const formatRow = (cells: string[], isHeader: boolean): string => {
    return cells
      .map((cell, i) => {
        const plainLen = stripAnsi(cell).length;
        const padLen = widths[i] - plainLen;
        const padded = cell + " ".repeat(Math.max(0, padLen));
        return isHeader ? colors.bold(padded) : padded;
      })
      .join(" ".repeat(gap));
  };

  const lines = [
    formatRow(headers, true),
    ...rows.map((r) => formatRow(r, false)),
  ];
  return lines.join("\n");
}
