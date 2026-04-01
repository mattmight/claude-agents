import type { Session } from "../types.js";
import type { ColorFunctions } from "../utils/colors.js";
import { statusIndicator } from "./table.js";
import type { SessionJson } from "./json.js";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const k = 1024;
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
  const value = bytes / Math.pow(k, i);
  return i === 0 ? `${bytes} B` : `${value.toFixed(1)} ${units[i]}`;
}

function formatDateTime(d: Date): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatInspectDetail(
  session: Session,
  colors: ColorFunctions,
): string {
  const statusStr = statusIndicator(session.status, colors);
  const pidSuffix =
    session.pid !== null ? ` (PID ${session.pid})` : "";

  const lines = [
    `${colors.bold("Session:")}     ${session.id}`,
    `${colors.bold("Project:")}     ${session.projectPath ?? "(unknown)"}`,
    `${colors.bold("Branch:")}      ${session.branch ?? "(none)"}`,
    `${colors.bold("Status:")}      ${statusStr}${pidSuffix}`,
    `${colors.bold("Created:")}     ${formatDateTime(session.createdAt)}`,
    `${colors.bold("Updated:")}     ${formatDateTime(session.updatedAt)}`,
    `${colors.bold("Messages:")}    ${session.messageCount}`,
  ];

  if (session.summary) {
    lines.push(`${colors.bold("Summary:")}     ${session.summary}`);
  }

  lines.push(
    `${colors.bold("JSONL Size:")}  ${formatBytes(session.jsonlSizeBytes)}`,
  );

  if (session.subAgents.length > 0) {
    const agentList = session.subAgents
      .map((a) => `agent-${a.agentId}`)
      .join(", ");
    lines.push(`${colors.bold("Sub-agents:")}  ${agentList}`);
  }

  return lines.join("\n");
}

export function formatInspectJson(session: Session): string {
  const data: SessionJson & { sub_agents: { agent_id: string; agent_type: string | null; description: string | null }[] } = {
    id: session.id,
    project_path: session.projectPath,
    branch: session.branch,
    status: session.status ?? "unknown",
    updated_at: session.updatedAt.toISOString(),
    created_at: session.createdAt.toISOString(),
    message_count: session.messageCount,
    summary: session.summary,
    first_prompt: session.firstPrompt,
    jsonl_path: session.jsonlPath,
    jsonl_size_bytes: session.jsonlSizeBytes,
    is_sidechain: session.isSidechain,
    pid: session.pid,
    sub_agents: session.subAgents.map((a) => ({
      agent_id: a.agentId,
      agent_type: a.agentType,
      description: a.description,
    })),
  };
  return JSON.stringify(data, null, 2);
}
