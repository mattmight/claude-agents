import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ScannerOptions, Session, SessionStatus } from "../types.js";
import { buildProjectRows } from "../commands/projects.js";
import { enumerateAllSessions } from "../core/session-enumerator.js";
import { checkAllSessionsLiveness } from "../core/liveness.js";
import { resolveSessionById } from "../commands/inspect.js";
import { buildStatusData } from "../commands/status.js";
import { parseDuration } from "../utils/duration.js";

const STATUS_PRIORITY: Record<string, number> = {
  active: 0,
  likely_active: 1,
  stopped: 2,
  unknown: 3,
};

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

export function registerTools(
  server: McpServer,
  scannerOptions: ScannerOptions,
): void {
  // list_projects
  server.registerTool(
    "list_projects",
    {
      description:
        "List all known Claude Code projects with session counts and status.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        active_only: z
          .boolean()
          .optional()
          .describe("Only return projects with active sessions"),
        sort_by: z
          .enum(["path", "last_active", "session_count"])
          .optional()
          .describe("Sort field (default: path)"),
      },
    },
    async ({ active_only, sort_by }) => {
      let rows = await buildProjectRows(scannerOptions);

      if (active_only) {
        rows = rows.filter((r) => r.status === "active");
      }

      const sortField = sort_by ?? "path";
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

      const data = rows.map((p) => ({
        path: p.path,
        encoded_dir: p.encodedDir,
        session_count: p.sessionCount,
        last_active: p.lastActive ? p.lastActive.toISOString() : null,
        status: p.status,
        active_sessions: p.activeSessionCount,
      }));

      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  // list_sessions
  server.registerTool(
    "list_sessions",
    {
      description:
        "List Claude Code sessions, optionally filtered by project, status, or time.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        project_path: z
          .string()
          .optional()
          .describe("Filter to sessions in this project (exact or substring match)"),
        active_only: z
          .boolean()
          .optional()
          .describe("Only return active/likely_active sessions"),
        latest_only: z
          .boolean()
          .optional()
          .describe("Return only the most recent session per project"),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum sessions to return (default: 50)"),
        since: z
          .string()
          .optional()
          .describe("Only sessions updated within this duration (e.g., '1h', '7d')"),
        sort_by: z
          .enum(["time", "project", "status"])
          .optional()
          .describe("Sort field (default: time)"),
      },
    },
    async ({ project_path, active_only, latest_only, limit, since, sort_by }) => {
      let sessions = await enumerateAllSessions(scannerOptions);
      await checkAllSessionsLiveness(sessions, scannerOptions);

      // Filter: project path
      if (project_path) {
        const exact = sessions.filter((s) => s.projectPath === project_path);
        if (exact.length > 0) {
          sessions = exact;
        } else {
          const lower = project_path.toLowerCase();
          sessions = sessions.filter(
            (s) =>
              s.projectPath !== null &&
              s.projectPath.toLowerCase().includes(lower),
          );
        }
      }

      // Filter: since
      if (since) {
        try {
          const ms = parseDuration(since);
          const cutoff = new Date(Date.now() - ms);
          sessions = sessions.filter((s) => s.updatedAt >= cutoff);
        } catch (err: unknown) {
          return {
            content: [
              {
                type: "text" as const,
                text: err instanceof Error ? err.message : String(err),
              },
            ],
            isError: true,
          };
        }
      }

      // Filter: active_only
      if (active_only) {
        sessions = sessions.filter(
          (s) => s.status === "active" || s.status === "likely_active",
        );
      }

      // Filter: latest_only
      if (latest_only) {
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
      const sortField = sort_by ?? "time";
      switch (sortField) {
        case "time":
          sessions.sort(
            (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
          );
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
      sessions = sessions.slice(0, limit ?? 50);

      const data = sessions.map(sessionToJson);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    },
  );

  // inspect_session
  server.registerTool(
    "inspect_session",
    {
      description:
        "Get detailed metadata for a single session by full UUID or unique prefix.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        session_id: z
          .string()
          .describe("Session UUID or unique prefix"),
      },
    },
    async ({ session_id }) => {
      const sessions = await enumerateAllSessions(scannerOptions);
      await checkAllSessionsLiveness(sessions, scannerOptions);

      try {
        const session = resolveSessionById(sessions, session_id);
        const data = {
          ...sessionToJson(session),
          sub_agents: session.subAgents.map((a) => ({
            agent_id: a.agentId,
            agent_type: a.agentType,
            description: a.description,
          })),
        };
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(data, null, 2) },
          ],
        };
      } catch (err: unknown) {
        return {
          content: [
            {
              type: "text" as const,
              text: err instanceof Error ? err.message : String(err),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // get_status
  server.registerTool(
    "get_status",
    {
      description:
        "Get aggregate dashboard summary: project count, session count, active count, active session list.",
      annotations: { readOnlyHint: true },
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
        content: [{ type: "text" as const, text: JSON.stringify(json, null, 2) }],
      };
    },
  );

  // find_session
  server.registerTool(
    "find_session",
    {
      description:
        "Search sessions by summary text or branch name. Returns matching sessions.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        query: z
          .string()
          .describe("Search term to match against session summaries and branch names"),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum results to return (default: 10)"),
      },
    },
    async ({ query, limit }) => {
      const sessions = await enumerateAllSessions(scannerOptions);
      await checkAllSessionsLiveness(sessions, scannerOptions);

      const lower = query.toLowerCase();
      const matches = sessions.filter((s) => {
        if (s.summary && s.summary.toLowerCase().includes(lower)) return true;
        if (s.branch && s.branch.toLowerCase().includes(lower)) return true;
        if (s.firstPrompt && s.firstPrompt.toLowerCase().includes(lower))
          return true;
        return false;
      });

      matches.sort(
        (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
      );

      const trimmed = matches.slice(0, limit ?? 10);
      const data = trimmed.map(sessionToJson);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    },
  );
}
