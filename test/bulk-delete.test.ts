import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import {
  selectSessionsForBulkDelete,
  bulkDeleteSessions,
  pruneHistoryFile,
} from "../src/core/session-deleter.js";
import { mkdir, writeFile, readFile, stat, rm, utimes } from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

/** Create a temp claude dir with multiple sessions for bulk testing. */
async function createBulkTestDir(): Promise<{
  claudeDir: string;
  stoppedId: string;
  recentId: string;
}> {
  const claudeDir = path.join(
    os.tmpdir(),
    `claude-agents-bulk-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const encodedProject = "-tmp-bulk-project";
  const projectDir = path.join(claudeDir, "projects", encodedProject);
  await mkdir(projectDir, { recursive: true });

  const stoppedId = "stopped0-0000-0000-0000-000000000000";
  const recentId = "recent00-0000-0000-0000-000000000000";

  // Stopped session — old JSONL (backdate mtime so liveness marks it "stopped")
  const stoppedJsonl = path.join(projectDir, `${stoppedId}.jsonl`);
  await writeFile(
    stoppedJsonl,
    `{"type":"user","timestamp":"2024-01-01T00:00:00Z","sessionId":"${stoppedId}"}\n`,
  );
  const oldDate = new Date("2024-01-01T00:00:00Z");
  await utimes(stoppedJsonl, oldDate, oldDate);

  // Recent session — fresh JSONL (mtime will be now)
  const recentJsonl = path.join(projectDir, `${recentId}.jsonl`);
  await writeFile(
    recentJsonl,
    `{"type":"user","timestamp":"${new Date().toISOString()}","sessionId":"${recentId}"}\n`,
  );

  // sessions-index.json with both
  const index = {
    version: 1,
    entries: [
      {
        sessionId: stoppedId,
        fullPath: stoppedJsonl,
        fileMtime: Date.now() - 86400000 * 60,
        firstPrompt: "old",
        summary: "Old session",
        messageCount: 1,
        created: "2024-01-01T00:00:00Z",
        modified: "2024-01-01T00:00:01Z",
        gitBranch: "main",
        projectPath: "/tmp/bulk-project",
        isSidechain: false,
      },
      {
        sessionId: recentId,
        fullPath: recentJsonl,
        fileMtime: Date.now(),
        firstPrompt: "recent",
        summary: "Recent session",
        messageCount: 1,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        gitBranch: "dev",
        projectPath: "/tmp/bulk-project",
        isSidechain: false,
      },
    ],
    originalPath: "/tmp/bulk-project",
  };
  await writeFile(
    path.join(projectDir, "sessions-index.json"),
    JSON.stringify(index, null, 2),
  );

  // history.jsonl
  await writeFile(
    path.join(claudeDir, "history.jsonl"),
    [
      JSON.stringify({ display: "old cmd", pastedContents: {}, timestamp: 1700000000, project: "/tmp/bulk-project", sessionId: stoppedId }),
      JSON.stringify({ display: "recent cmd", pastedContents: {}, timestamp: Date.now(), project: "/tmp/bulk-project", sessionId: recentId }),
      JSON.stringify({ display: "unrelated", pastedContents: {}, timestamp: Date.now(), project: "/other", sessionId: "other-id" }),
    ].join("\n") + "\n",
  );

  return { claudeDir, stoppedId, recentId };
}

describe("bulk deletion", () => {
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      const err = new Error("ESRCH") as NodeJS.ErrnoException;
      err.code = "ESRCH";
      throw err;
    });
  });

  afterEach(() => {
    killSpy.mockRestore();
  });

  describe("selectSessionsForBulkDelete", () => {
    it("selects stopped sessions with --all-stopped", async () => {
      const { claudeDir, stoppedId } = await createBulkTestDir();
      try {
        const sessions = await selectSessionsForBulkDelete({
          claudeDir,
          allStopped: true,
        });
        const ids = sessions.map((s) => s.id);
        expect(ids).toContain(stoppedId);
        // The "recent" session might be likely_active due to mtime
        for (const s of sessions) {
          expect(s.status).toBe("stopped");
        }
      } finally {
        await rm(claudeDir, { recursive: true, force: true });
      }
    });

    it("filters by --before duration", async () => {
      const { claudeDir } = await createBulkTestDir();
      try {
        // "1s" means sessions updated more than 1 second ago
        // The stopped session is old, so it should match
        const sessions = await selectSessionsForBulkDelete({
          claudeDir,
          allStopped: true,
          before: "1s",
        });
        // All returned sessions should have old updatedAt
        for (const s of sessions) {
          expect(s.updatedAt.getTime()).toBeLessThan(Date.now() - 500);
        }
      } finally {
        await rm(claudeDir, { recursive: true, force: true });
      }
    });

    it("filters by --project", async () => {
      const { claudeDir } = await createBulkTestDir();
      try {
        const sessions = await selectSessionsForBulkDelete({
          claudeDir,
          projectPath: "bulk-project",
        });
        for (const s of sessions) {
          expect(s.projectPath?.toLowerCase()).toContain("bulk-project");
        }
      } finally {
        await rm(claudeDir, { recursive: true, force: true });
      }
    });
  });

  describe("bulkDeleteSessions", () => {
    it("deletes matching sessions and returns summary", async () => {
      const { claudeDir, stoppedId } = await createBulkTestDir();
      try {
        const result = await bulkDeleteSessions({
          claudeDir,
          allStopped: true,
        });
        expect(result.totalSessionsDeleted).toBeGreaterThan(0);
        expect(result.totalFilesDeleted).toBeGreaterThan(0);

        // Verify the stopped session JSONL is gone
        const jsonlPath = path.join(
          claudeDir,
          "projects",
          "-tmp-bulk-project",
          `${stoppedId}.jsonl`,
        );
        await expect(stat(jsonlPath)).rejects.toThrow();
      } finally {
        await rm(claudeDir, { recursive: true, force: true });
      }
    });
  });

  describe("pruneHistoryFile", () => {
    it("removes matching entries from history.jsonl", async () => {
      const { claudeDir, stoppedId } = await createBulkTestDir();
      try {
        const removed = await pruneHistoryFile(
          new Set([stoppedId]),
          { claudeDir },
        );
        expect(removed).toBe(1);

        // Verify the remaining file doesn't contain the stopped session
        const raw = await readFile(
          path.join(claudeDir, "history.jsonl"),
          "utf-8",
        );
        expect(raw).not.toContain(stoppedId);
        // Other entries preserved
        expect(raw).toContain("other-id");
      } finally {
        await rm(claudeDir, { recursive: true, force: true });
      }
    });

    it("returns 0 when no entries match", async () => {
      const { claudeDir } = await createBulkTestDir();
      try {
        const removed = await pruneHistoryFile(
          new Set(["nonexistent-id"]),
          { claudeDir },
        );
        expect(removed).toBe(0);
      } finally {
        await rm(claudeDir, { recursive: true, force: true });
      }
    });

    it("handles missing history file", async () => {
      const removed = await pruneHistoryFile(
        new Set(["any-id"]),
        { claudeDir: "/nonexistent/path" },
      );
      expect(removed).toBe(0);
    });
  });

  describe("bulkDeleteSessions with --prune-history", () => {
    it("prunes history entries for deleted sessions", async () => {
      const { claudeDir, stoppedId } = await createBulkTestDir();
      try {
        const result = await bulkDeleteSessions({
          claudeDir,
          allStopped: true,
          pruneHistory: true,
        });
        expect(result.prunedHistoryEntries).toBeGreaterThan(0);

        const raw = await readFile(
          path.join(claudeDir, "history.jsonl"),
          "utf-8",
        );
        expect(raw).not.toContain(stoppedId);
      } finally {
        await rm(claudeDir, { recursive: true, force: true });
      }
    });
  });
});
