import type { Session } from "../types.js";
import type { ProjectRow } from "./table.js";

export interface ProjectJson {
  path: string;
  encoded_dir: string;
  session_count: number;
  last_active: string | null;
  status: "active" | "stopped";
  active_sessions: number;
}

export interface SessionJson {
  id: string;
  project_path: string | null;
  branch: string | null;
  status: string;
  updated_at: string;
  created_at: string;
  message_count: number;
  summary: string | null;
  first_prompt: string | null;
  jsonl_path: string | null;
  jsonl_size_bytes: number;
  is_sidechain: boolean;
  pid: number | null;
}

export function formatProjectsJson(projects: ProjectRow[]): string {
  const data: ProjectJson[] = projects.map((p) => ({
    path: p.path,
    encoded_dir: p.encodedDir,
    session_count: p.sessionCount,
    last_active: p.lastActive ? p.lastActive.toISOString() : null,
    status: p.status,
    active_sessions: p.activeSessionCount,
  }));
  return JSON.stringify(data, null, 2);
}

export function formatSessionsJson(sessions: Session[]): string {
  const data: SessionJson[] = sessions.map((s) => ({
    id: s.id,
    project_path: s.projectPath,
    branch: s.branch,
    status: s.status ?? "unknown",
    updated_at: s.updatedAt.toISOString(),
    created_at: s.createdAt.toISOString(),
    message_count: s.messageCount,
    summary: s.summary,
    first_prompt: s.firstPrompt,
    jsonl_path: s.jsonlPath,
    jsonl_size_bytes: s.jsonlSizeBytes,
    is_sidechain: s.isSidechain,
    pid: s.pid,
  }));
  return JSON.stringify(data, null, 2);
}
