import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import {
  planSessionDeletion,
  deleteSession,
} from "../src/core/session-deleter.js";
import { mkdir, writeFile, readFile, stat, rm } from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

/**
 * Create a temporary Claude-like directory structure with a session
 * that can be deleted by tests.
 */
async function createTempClaudeDir(): Promise<{
  claudeDir: string;
  sessionId: string;
  projectDir: string;
}> {
  const claudeDir = path.join(
    os.tmpdir(),
    `claude-agents-del-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const sessionId = "deadbeef-cafe-1234-5678-abcdef012345";
  const encodedProject = "-tmp-my-project";
  const projectDir = path.join(claudeDir, "projects", encodedProject);

  // Create project dir with session files
  await mkdir(projectDir, { recursive: true });

  // Main JSONL
  const jsonlPath = path.join(projectDir, `${sessionId}.jsonl`);
  await writeFile(
    jsonlPath,
    '{"type":"user","message":{"content":"hello"},"timestamp":"2025-01-01T00:00:00Z","sessionId":"' +
      sessionId +
      '"}\n',
  );

  // Session subdirectory with subagent
  const subagentsDir = path.join(projectDir, sessionId, "subagents");
  await mkdir(subagentsDir, { recursive: true });
  await writeFile(
    path.join(subagentsDir, "agent-abc123.jsonl"),
    '{"type":"user"}\n',
  );

  // sessions-index.json with this session + another
  const index = {
    version: 1,
    entries: [
      {
        sessionId,
        fullPath: jsonlPath,
        fileMtime: Date.now(),
        firstPrompt: "hello",
        summary: "Test",
        messageCount: 1,
        created: "2025-01-01T00:00:00Z",
        modified: "2025-01-01T00:00:01Z",
        gitBranch: "main",
        projectPath: "/tmp/my-project",
        isSidechain: false,
      },
      {
        sessionId: "other-session-0000-0000-000000000000",
        fullPath: path.join(projectDir, "other-session-0000-0000-000000000000.jsonl"),
        fileMtime: Date.now(),
        firstPrompt: "other",
        summary: "Other",
        messageCount: 2,
        created: "2025-01-02T00:00:00Z",
        modified: "2025-01-02T00:00:01Z",
        gitBranch: "dev",
        projectPath: "/tmp/my-project",
        isSidechain: false,
      },
    ],
    originalPath: "/tmp/my-project",
  };
  await writeFile(
    path.join(projectDir, "sessions-index.json"),
    JSON.stringify(index, null, 2),
  );

  // PID registry
  const sessionsDir = path.join(claudeDir, "sessions");
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    path.join(sessionsDir, "12345.json"),
    JSON.stringify({ pid: 12345, sessionId, cwd: "/tmp/my-project", startedAt: Date.now() }),
  );

  // session-env
  const sessionEnvDir = path.join(claudeDir, "session-env", sessionId);
  await mkdir(sessionEnvDir, { recursive: true });
  await writeFile(path.join(sessionEnvDir, "env.json"), "{}");

  // debug log
  const debugDir = path.join(claudeDir, "debug");
  await mkdir(debugDir, { recursive: true });
  await writeFile(path.join(debugDir, `${sessionId}.txt`), "debug data");

  return { claudeDir, sessionId, projectDir };
}

describe("session-deleter", () => {
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // All PIDs are dead
    killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      const err = new Error("ESRCH") as NodeJS.ErrnoException;
      err.code = "ESRCH";
      throw err;
    });
  });

  afterEach(() => {
    killSpy.mockRestore();
  });

  describe("planSessionDeletion", () => {
    it("lists all targets without modifying files", async () => {
      const { claudeDir, sessionId } = await createTempClaudeDir();
      try {
        const plan = await planSessionDeletion(sessionId, {
          claudeDir,
        });

        expect(plan.sessionId).toBe(sessionId);
        expect(plan.targets.length).toBeGreaterThan(0);
        expect(plan.totalBytes).toBeGreaterThan(0);
        expect(plan.updatesSessionsIndex).toBe(true);

        // Verify files still exist
        const jsonlPath = path.join(
          claudeDir,
          "projects",
          "-tmp-my-project",
          `${sessionId}.jsonl`,
        );
        await expect(stat(jsonlPath)).resolves.toBeDefined();
      } finally {
        await rm(claudeDir, { recursive: true, force: true });
      }
    });

    it("warns for active sessions", async () => {
      const { claudeDir, sessionId } = await createTempClaudeDir();
      try {
        // Make the PID appear alive
        killSpy.mockImplementation(((pid: number) => {
          if (pid === 12345) return true;
          const err = new Error("ESRCH") as NodeJS.ErrnoException;
          err.code = "ESRCH";
          throw err;
        }) as typeof process.kill);

        const plan = await planSessionDeletion(sessionId, { claudeDir });
        expect(plan.warning).toContain("active");
      } finally {
        await rm(claudeDir, { recursive: true, force: true });
      }
    });
  });

  describe("deleteSession", () => {
    it("removes JSONL, subdirectory, PID registry, session-env, and debug log", async () => {
      const { claudeDir, sessionId, projectDir } = await createTempClaudeDir();
      try {
        const result = await deleteSession(sessionId, { claudeDir });

        expect(result.sessionId).toBe(sessionId);
        expect(result.deleted.length).toBeGreaterThan(0);
        expect(result.totalBytesFreed).toBeGreaterThan(0);

        // JSONL removed
        const jsonlPath = path.join(projectDir, `${sessionId}.jsonl`);
        await expect(stat(jsonlPath)).rejects.toThrow();

        // Session subdir removed
        const sessionDir = path.join(projectDir, sessionId);
        await expect(stat(sessionDir)).rejects.toThrow();

        // PID registry removed
        const pidFile = path.join(claudeDir, "sessions", "12345.json");
        await expect(stat(pidFile)).rejects.toThrow();

        // session-env removed
        const envDir = path.join(claudeDir, "session-env", sessionId);
        await expect(stat(envDir)).rejects.toThrow();

        // debug log removed
        const debugLog = path.join(claudeDir, "debug", `${sessionId}.txt`);
        await expect(stat(debugLog)).rejects.toThrow();
      } finally {
        await rm(claudeDir, { recursive: true, force: true });
      }
    });

    it("updates sessions-index.json, preserving other entries", async () => {
      const { claudeDir, sessionId, projectDir } = await createTempClaudeDir();
      try {
        await deleteSession(sessionId, { claudeDir });

        const indexPath = path.join(projectDir, "sessions-index.json");
        const raw = await readFile(indexPath, "utf-8");
        const index = JSON.parse(raw);

        // Deleted session gone
        expect(
          index.entries.find(
            (e: { sessionId: string }) => e.sessionId === sessionId,
          ),
        ).toBeUndefined();

        // Other session preserved
        expect(
          index.entries.find(
            (e: { sessionId: string }) =>
              e.sessionId === "other-session-0000-0000-000000000000",
          ),
        ).toBeDefined();
        expect(index.entries).toHaveLength(1);
      } finally {
        await rm(claudeDir, { recursive: true, force: true });
      }
    });

    it("refuses to delete active sessions without --force", async () => {
      const { claudeDir, sessionId } = await createTempClaudeDir();
      try {
        killSpy.mockImplementation(((pid: number) => {
          if (pid === 12345) return true;
          const err = new Error("ESRCH") as NodeJS.ErrnoException;
          err.code = "ESRCH";
          throw err;
        }) as typeof process.kill);

        await expect(
          deleteSession(sessionId, { claudeDir }),
        ).rejects.toThrow(/active/);
      } finally {
        await rm(claudeDir, { recursive: true, force: true });
      }
    });

    it("deletes active sessions with --force", async () => {
      const { claudeDir, sessionId, projectDir } = await createTempClaudeDir();
      try {
        killSpy.mockImplementation(((pid: number) => {
          if (pid === 12345) return true;
          const err = new Error("ESRCH") as NodeJS.ErrnoException;
          err.code = "ESRCH";
          throw err;
        }) as typeof process.kill);

        const result = await deleteSession(sessionId, {
          claudeDir,
          force: true,
        });
        expect(result.deleted.length).toBeGreaterThan(0);

        // JSONL removed
        const jsonlPath = path.join(projectDir, `${sessionId}.jsonl`);
        await expect(stat(jsonlPath)).rejects.toThrow();
      } finally {
        await rm(claudeDir, { recursive: true, force: true });
      }
    });

    it("handles partially missing files gracefully", async () => {
      const { claudeDir, sessionId } = await createTempClaudeDir();
      try {
        // Pre-delete the debug log to simulate partial state
        const debugLog = path.join(
          claudeDir,
          "debug",
          `${sessionId}.txt`,
        );
        await rm(debugLog);

        // Should not throw
        const result = await deleteSession(sessionId, { claudeDir });
        expect(result.sessionId).toBe(sessionId);
        // The debug log was already gone, so targets list won't include it
        expect(result.deleted.length).toBeGreaterThan(0);
      } finally {
        await rm(claudeDir, { recursive: true, force: true });
      }
    });
  });
});
