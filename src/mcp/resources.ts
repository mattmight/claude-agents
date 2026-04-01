import {
  ResourceTemplate,
  type McpServer,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ScannerOptions, Session } from "../types.js";
import { buildProjectRows } from "../commands/projects.js";
import { enumerateAllSessions } from "../core/session-enumerator.js";
import { checkAllSessionsLiveness } from "../core/liveness.js";
import { resolveSessionById } from "../commands/inspect.js";
import { buildStatusData } from "../commands/status.js";
import { scanProjectDirs } from "../core/scanner.js";
import { resolveAllProjects } from "../core/path-resolver.js";
import { enumerateProjectSessions } from "../core/session-enumerator.js";
import { getProjectsDir } from "../core/scanner.js";
import * as path from "node:path";

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
    first_prompt: s.firstPrompt,
    jsonl_path: s.jsonlPath,
    jsonl_size_bytes: s.jsonlSizeBytes,
    is_sidechain: s.isSidechain,
    pid: s.pid,
  };
}

export function registerResources(
  server: McpServer,
  scannerOptions: ScannerOptions,
): void {
  // Static resource: projects list
  server.registerResource(
    "projects",
    "claude-agents://projects",
    {
      description: "List of all Claude Code projects with session counts and status",
      mimeType: "application/json",
    },
    async () => {
      const rows = await buildProjectRows(scannerOptions);
      rows.sort((a, b) => a.path.localeCompare(b.path));
      const data = rows.map((p) => ({
        path: p.path,
        encoded_dir: p.encodedDir,
        session_count: p.sessionCount,
        last_active: p.lastActive ? p.lastActive.toISOString() : null,
        status: p.status,
        active_sessions: p.activeSessionCount,
      }));
      return {
        contents: [
          {
            uri: "claude-agents://projects",
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    },
  );

  // Template resource: single project by encoded dir
  server.registerResource(
    "project",
    new ResourceTemplate("claude-agents://projects/{encoded_dir}", {
      list: async () => {
        const encodedDirs = await scanProjectDirs(scannerOptions);
        const projects = await resolveAllProjects(encodedDirs, scannerOptions);
        return {
          resources: projects.map((p) => ({
            uri: `claude-agents://projects/${encodeURIComponent(p.encodedDir)}`,
            name: p.realPath ?? p.encodedDir,
            description: `Project: ${p.realPath ?? p.encodedDir}`,
            mimeType: "application/json",
          })),
        };
      },
      complete: {
        encoded_dir: async (value: string) => {
          const encodedDirs = await scanProjectDirs(scannerOptions);
          return encodedDirs.filter((d) =>
            d.toLowerCase().startsWith(value.toLowerCase()),
          );
        },
      },
    }),
    {
      description: "A single Claude Code project with all its sessions",
      mimeType: "application/json",
    },
    async (_uri, variables) => {
      const encodedDir = Array.isArray(variables.encoded_dir)
        ? variables.encoded_dir[0]
        : variables.encoded_dir;

      const encodedDirs = await scanProjectDirs(scannerOptions);
      const decoded = decodeURIComponent(encodedDir);
      if (!encodedDirs.includes(decoded)) {
        throw new Error(`Project not found: ${encodedDir}`);
      }

      const projects = await resolveAllProjects([decoded], scannerOptions);
      const project = projects[0];
      const projectsDir = getProjectsDir(scannerOptions);
      const dirPath = path.join(projectsDir, project.encodedDir);
      const sessions = await enumerateProjectSessions(
        dirPath,
        project.realPath,
      );
      await checkAllSessionsLiveness(sessions, scannerOptions);

      const data = {
        path: project.realPath ?? project.encodedDir,
        encoded_dir: project.encodedDir,
        sessions: sessions.map(sessionToJson),
      };

      return {
        contents: [
          {
            uri: `claude-agents://projects/${encodeURIComponent(decoded)}`,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    },
  );

  // Template resource: single session by ID
  server.registerResource(
    "session",
    new ResourceTemplate("claude-agents://sessions/{session_id}", {
      list: async () => {
        const sessions = await enumerateAllSessions(scannerOptions);
        return {
          resources: sessions.map((s) => ({
            uri: `claude-agents://sessions/${s.id}`,
            name: `${s.id} (${s.projectPath ?? "unknown"})`,
            description: s.summary ?? s.firstPrompt ?? `Session ${s.id}`,
            mimeType: "application/json",
          })),
        };
      },
      complete: {
        session_id: async (value: string) => {
          const sessions = await enumerateAllSessions(scannerOptions);
          const lower = value.toLowerCase();
          return sessions
            .filter((s) => s.id.toLowerCase().startsWith(lower))
            .map((s) => s.id)
            .slice(0, 20);
        },
      },
    }),
    {
      description: "Detailed metadata for a single Claude Code session",
      mimeType: "application/json",
    },
    async (_uri, variables) => {
      const sessionId = Array.isArray(variables.session_id)
        ? variables.session_id[0]
        : variables.session_id;

      const sessions = await enumerateAllSessions(scannerOptions);
      await checkAllSessionsLiveness(sessions, scannerOptions);
      const session = resolveSessionById(sessions, sessionId);

      const data = {
        ...sessionToJson(session),
        sub_agents: session.subAgents.map((a) => ({
          agent_id: a.agentId,
          agent_type: a.agentType,
          description: a.description,
        })),
      };

      return {
        contents: [
          {
            uri: `claude-agents://sessions/${session.id}`,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    },
  );

  // Static resource: status
  server.registerResource(
    "status",
    "claude-agents://status",
    {
      description: "Aggregate status summary of all Claude Code sessions",
      mimeType: "application/json",
    },
    async () => {
      const data = await buildStatusData(scannerOptions);
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

      return {
        contents: [
          {
            uri: "claude-agents://status",
            mimeType: "application/json",
            text: JSON.stringify(json, null, 2),
          },
        ],
      };
    },
  );
}
