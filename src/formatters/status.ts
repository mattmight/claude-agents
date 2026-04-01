import type { StatusData } from "../commands/status.js";
import type { ColorFunctions } from "../utils/colors.js";

export function formatStatusDashboard(
  data: StatusData,
  colors: ColorFunctions,
): string {
  const lines = [
    colors.bold("Claude Code Sessions"),
    "\u2501".repeat(19),
    `  Projects:       ${data.projectCount}`,
    `  Total sessions: ${data.totalSessions}`,
    `  Active:         ${data.activeSessions}`,
    `  Last 24h:       ${data.last24hSessions}`,
  ];

  if (data.activeSessionList.length > 0) {
    lines.push("");
    lines.push(colors.bold("Active Sessions:"));
    for (const s of data.activeSessionList) {
      const indicator =
        s.status === "active"
          ? colors.green("\u25CF")
          : colors.yellow("\u25CE");
      const project = s.projectPath ?? "(unknown)";
      const branch = s.branch ?? "";
      const msgs = `${s.messageCount} msgs`;
      const pid = s.pid !== null ? `PID ${s.pid}` : "(no PID)";
      lines.push(
        `  ${indicator} ${project.padEnd(35)} ${branch.padEnd(14)} ${msgs.padEnd(10)} ${pid}`,
      );
    }
  }

  return lines.join("\n");
}

export function formatStatusJson(data: StatusData): string {
  const json = {
    project_count: data.projectCount,
    total_sessions: data.totalSessions,
    active_sessions: data.activeSessions,
    last_24h_sessions: data.last24hSessions,
    active_session_list: data.activeSessionList.map((s) => ({
      id: s.id,
      project_path: s.projectPath,
      branch: s.branch,
      status: s.status ?? "unknown",
      message_count: s.messageCount,
      pid: s.pid,
    })),
  };
  return JSON.stringify(json, null, 2);
}
