import { readFile, readdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import type { Dirent } from "node:fs";
import type {
  Session,
  SessionsIndex,
  SubAgent,
  SubAgentMeta,
  ScannerOptions,
} from "../types.js";
import { scanProjectDirs, getProjectsDir } from "./scanner.js";
import { resolveAllProjects } from "./path-resolver.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MESSAGE_TYPES = new Set(["user", "assistant", "system"]);

/**
 * Enumerate all sessions for a single project directory.
 */
export async function enumerateProjectSessions(
  projectDirPath: string,
  projectRealPath: string | null,
): Promise<Session[]> {
  // Try sessions-index.json first
  let sessions = await sessionsFromIndex(projectDirPath, projectRealPath);

  // Fallback: scan for JSONL files
  if (sessions === null) {
    sessions = await sessionsFromJsonlScan(projectDirPath, projectRealPath);
  }

  // Discover sub-agents for each session
  await Promise.all(
    sessions.map(async (session) => {
      session.subAgents = await discoverSubAgents(projectDirPath, session.id);
    }),
  );

  // Sort by updatedAt descending
  sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  return sessions;
}

/**
 * Enumerate sessions across all projects.
 */
export async function enumerateAllSessions(
  options?: ScannerOptions,
): Promise<Session[]> {
  const encodedDirs = await scanProjectDirs(options);
  if (encodedDirs.length === 0) return [];

  const projects = await resolveAllProjects(encodedDirs, options);
  const projectsDir = getProjectsDir(options);

  const allSessions: Session[] = [];

  await Promise.all(
    projects.map(async (project) => {
      const dirPath = path.join(projectsDir, project.encodedDir);
      const sessions = await enumerateProjectSessions(
        dirPath,
        project.realPath,
      );
      allSessions.push(...sessions);
    }),
  );

  // Sort all sessions by updatedAt descending
  allSessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  return allSessions;
}

/**
 * Discover sub-agents for a given session.
 */
export async function discoverSubAgents(
  projectDirPath: string,
  sessionId: string,
): Promise<SubAgent[]> {
  const subagentsDir = path.join(projectDirPath, sessionId, "subagents");

  let entries: Dirent[];
  try {
    entries = await readdir(subagentsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const agentPattern = /^agent-(.+)\.jsonl$/;
  const subAgents: SubAgent[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = entry.name.match(agentPattern);
    if (!match) continue;

    const agentId = match[1];
    const jsonlPath = path.join(subagentsDir, entry.name);

    // Try to read meta.json
    let agentType: string | null = null;
    let description: string | null = null;

    const metaPath = path.join(subagentsDir, `agent-${agentId}.meta.json`);
    try {
      const metaRaw = await readFile(metaPath, "utf-8");
      const meta = JSON.parse(metaRaw) as Partial<SubAgentMeta>;
      agentType = meta.agentType ?? null;
      description = meta.description ?? null;
    } catch {
      // No meta file or malformed — leave as null
    }

    subAgents.push({ agentId, jsonlPath, agentType, description });
  }

  return subAgents;
}

/**
 * Build sessions from sessions-index.json.
 * Returns null if the file doesn't exist or is malformed.
 */
async function sessionsFromIndex(
  projectDirPath: string,
  projectRealPath: string | null,
): Promise<Session[] | null> {
  const indexPath = path.join(projectDirPath, "sessions-index.json");

  let raw: string;
  try {
    raw = await readFile(indexPath, "utf-8");
  } catch {
    return null;
  }

  let index: Partial<SessionsIndex>;
  try {
    index = JSON.parse(raw) as Partial<SessionsIndex>;
  } catch {
    return null;
  }

  if (!index.entries || index.entries.length === 0) {
    return [];
  }

  const sessions: Session[] = [];

  await Promise.all(
    index.entries.map(async (entry) => {
      // Try to stat the JSONL file for size
      let jsonlPath: string | null = null;
      let jsonlSizeBytes = 0;

      // First try the fullPath from the index
      try {
        const fileStat = await stat(entry.fullPath);
        jsonlPath = entry.fullPath;
        jsonlSizeBytes = fileStat.size;
      } catch {
        // fullPath doesn't exist — try looking in the project dir
        const localPath = path.join(
          projectDirPath,
          `${entry.sessionId}.jsonl`,
        );
        try {
          const fileStat = await stat(localPath);
          jsonlPath = localPath;
          jsonlSizeBytes = fileStat.size;
        } catch {
          // File not on disk
        }
      }

      sessions.push({
        id: entry.sessionId,
        projectPath: projectRealPath ?? entry.projectPath ?? null,
        branch: entry.gitBranch || null,
        summary: entry.summary || null,
        firstPrompt: entry.firstPrompt || null,
        messageCount: entry.messageCount,
        createdAt: new Date(entry.created),
        updatedAt: new Date(entry.modified),
        jsonlPath,
        jsonlSizeBytes,
        isSidechain: entry.isSidechain,
        subAgents: [],
        source: "sessions-index",
        status: undefined,
        pid: null,
      });
    }),
  );

  return sessions;
}

/**
 * Build sessions by scanning for UUID-pattern .jsonl files.
 */
async function sessionsFromJsonlScan(
  projectDirPath: string,
  projectRealPath: string | null,
): Promise<Session[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(projectDirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const sessions: Session[] = [];

  await Promise.all(
    entries
      .filter((entry) => {
        if (!entry.isFile()) return false;
        const name = entry.name;
        if (!name.endsWith(".jsonl")) return false;
        const stem = name.slice(0, -6); // Remove .jsonl
        return UUID_PATTERN.test(stem);
      })
      .map(async (entry) => {
        const jsonlPath = path.join(projectDirPath, entry.name);
        const sessionId = entry.name.slice(0, -6);

        let jsonlSizeBytes = 0;
        let fileMtime = new Date();
        try {
          const fileStat = await stat(jsonlPath);
          jsonlSizeBytes = fileStat.size;
          fileMtime = fileStat.mtime;
        } catch {
          // Shouldn't happen since we just listed the file, but handle it
        }

        const parsed = await parseSessionJsonl(jsonlPath);

        sessions.push({
          id: sessionId,
          projectPath: projectRealPath,
          branch: parsed?.branch ?? null,
          summary: null, // No summary without sessions-index.json
          firstPrompt: parsed?.firstPrompt ?? null,
          messageCount: parsed?.messageCount ?? 0,
          createdAt: parsed?.createdAt ?? fileMtime,
          updatedAt: parsed?.updatedAt ?? fileMtime,
          jsonlPath,
          jsonlSizeBytes,
          isSidechain: parsed?.isSidechain ?? false,
          subAgents: [],
          source: "jsonl-scan",
          status: undefined,
          pid: null,
        });
      }),
  );

  return sessions;
}

/**
 * Parse a session JSONL file to extract metadata.
 * Counts only user, assistant, system types as messages.
 */
async function parseSessionJsonl(jsonlPath: string): Promise<{
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
  branch: string | null;
  firstPrompt: string | null;
  isSidechain: boolean;
} | null> {
  let stream: ReturnType<typeof createReadStream>;
  try {
    stream = createReadStream(jsonlPath, { encoding: "utf-8" });
  } catch {
    return null;
  }

  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;
  let messageCount = 0;
  let branch: string | null = null;
  let firstPrompt: string | null = null;
  let isSidechain = false;

  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        const type = entry.type as string | undefined;
        const timestamp = entry.timestamp as string | undefined;

        if (timestamp) {
          if (firstTimestamp === null) firstTimestamp = timestamp;
          lastTimestamp = timestamp;
        }

        if (type && MESSAGE_TYPES.has(type)) {
          messageCount++;

          // Extract first user prompt
          if (type === "user" && firstPrompt === null) {
            const message = entry.message as
              | { content?: unknown }
              | undefined;
            if (message?.content) {
              if (typeof message.content === "string") {
                firstPrompt = message.content;
              } else if (Array.isArray(message.content)) {
                const textBlock = message.content.find(
                  (b: unknown) =>
                    typeof b === "object" &&
                    b !== null &&
                    (b as Record<string, unknown>).type === "text",
                ) as { text?: string } | undefined;
                if (textBlock?.text) {
                  firstPrompt = textBlock.text;
                }
              }
            }
          }
        }

        if (
          branch === null &&
          typeof entry.gitBranch === "string" &&
          entry.gitBranch !== ""
        ) {
          branch = entry.gitBranch;
        }

        if (entry.isSidechain === true) {
          isSidechain = true;
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }
    throw err;
  }

  if (firstTimestamp === null) return null;

  return {
    messageCount,
    createdAt: new Date(firstTimestamp),
    updatedAt: new Date(lastTimestamp!),
    branch,
    firstPrompt,
    isSidechain,
  };
}
