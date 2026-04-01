import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getSessionsDir,
  checkSessionLiveness,
  checkAllSessionsLiveness,
} from "../src/core/liveness.js";
import type { Session } from "../src/types.js";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, "fixtures");
const MOCK_CLAUDE = path.join(FIXTURES, "mock-claude-dir");

/** Helper: create a minimal Session object for testing. */
function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    projectPath: "/Users/alice/projects/my-app",
    branch: "main",
    summary: "Test session",
    firstPrompt: "Hello",
    messageCount: 5,
    createdAt: new Date("2025-01-15T10:00:00Z"),
    updatedAt: new Date("2025-01-15T12:00:00Z"),
    jsonlPath: null,
    jsonlSizeBytes: 0,
    isSidechain: false,
    subAgents: [],
    source: "sessions-index",
    status: undefined,
    pid: null,
    ...overrides,
  };
}

describe("getSessionsDir", () => {
  it("returns default sessions directory", () => {
    const dir = getSessionsDir();
    expect(dir).toMatch(/\.claude[/\\]sessions$/);
  });

  it("respects claudeDir override", () => {
    const dir = getSessionsDir({ claudeDir: MOCK_CLAUDE });
    expect(dir).toBe(path.join(MOCK_CLAUDE, "sessions"));
  });
});

describe("checkSessionLiveness", () => {
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Default: all PIDs are dead (ESRCH)
    killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      const err = new Error("ESRCH") as NodeJS.ErrnoException;
      err.code = "ESRCH";
      throw err;
    });
  });

  afterEach(() => {
    killSpy.mockRestore();
  });

  it("returns 'stopped' for dead PID in registry with stale JSONL", async () => {
    // Session aaaaaaaa is in the registry with PID 99999
    // PID 99999 is dead (mocked above), JSONL path is null
    const session = makeSession({
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      // Give it a JSONL path to an old file so it doesn't return "unknown"
      jsonlPath: path.join(
        MOCK_CLAUDE,
        "projects",
        "-Users-alice-projects-my-app",
        "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl",
      ),
    });

    const result = await checkSessionLiveness(session, {
      claudeDir: MOCK_CLAUDE,
      recencyWindowSeconds: 0, // Treat everything as stale
    });

    expect(result.status).toBe("stopped");
    expect(result.pid).toBeNull();
  });

  it("returns 'unknown' when no JSONL path and no registry entry", async () => {
    const session = makeSession({
      id: "cccccccc-cccc-cccc-cccc-cccccccccccc", // Not in registry
      jsonlPath: null,
    });

    const result = await checkSessionLiveness(session, {
      claudeDir: MOCK_CLAUDE,
    });

    expect(result.status).toBe("unknown");
    expect(result.pid).toBeNull();
  });

  it("returns 'likely_active' with huge recency window", async () => {
    const session = makeSession({
      id: "cccccccc-cccc-cccc-cccc-cccccccccccc", // Not in registry
      jsonlPath: path.join(
        MOCK_CLAUDE,
        "projects",
        "-Users-alice-projects-my-app",
        "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl",
      ),
    });

    const result = await checkSessionLiveness(session, {
      claudeDir: MOCK_CLAUDE,
      recencyWindowSeconds: 999999999, // Everything is "recent"
    });

    expect(result.status).toBe("likely_active");
    expect(result.pid).toBeNull();
  });

  it("returns 'stopped' with recencyWindowSeconds: 0", async () => {
    const session = makeSession({
      id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      jsonlPath: path.join(
        MOCK_CLAUDE,
        "projects",
        "-Users-alice-projects-my-app",
        "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl",
      ),
    });

    const result = await checkSessionLiveness(session, {
      claudeDir: MOCK_CLAUDE,
      recencyWindowSeconds: 0,
    });

    expect(result.status).toBe("stopped");
    expect(result.pid).toBeNull();
  });

  it("returns 'active' when registry PID is alive", async () => {
    // Make PID 99999 appear alive
    killSpy.mockImplementation(((pid: number) => {
      if (pid === 99999) return true;
      const err = new Error("ESRCH") as NodeJS.ErrnoException;
      err.code = "ESRCH";
      throw err;
    }) as typeof process.kill);

    const session = makeSession({
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    });

    const result = await checkSessionLiveness(session, {
      claudeDir: MOCK_CLAUDE,
    });

    expect(result.status).toBe("active");
    expect(result.pid).toBe(99999);
  });

  it("treats EPERM as alive (process exists but no permission)", async () => {
    killSpy.mockImplementation(((pid: number) => {
      if (pid === 99999) {
        const err = new Error("EPERM") as NodeJS.ErrnoException;
        err.code = "EPERM";
        throw err;
      }
      const err = new Error("ESRCH") as NodeJS.ErrnoException;
      err.code = "ESRCH";
      throw err;
    }) as typeof process.kill);

    const session = makeSession({
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    });

    const result = await checkSessionLiveness(session, {
      claudeDir: MOCK_CLAUDE,
    });

    expect(result.status).toBe("active");
    expect(result.pid).toBe(99999);
  });

  it("falls through to recency when PID is dead", async () => {
    // PID 99999 is dead (default mock), but JSONL is "recent" with huge window
    const session = makeSession({
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      jsonlPath: path.join(
        MOCK_CLAUDE,
        "projects",
        "-Users-alice-projects-my-app",
        "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl",
      ),
    });

    const result = await checkSessionLiveness(session, {
      claudeDir: MOCK_CLAUDE,
      recencyWindowSeconds: 999999999,
    });

    expect(result.status).toBe("likely_active");
    // pid from registry entry even though process is dead (included for context)
    expect(result.pid).toBe(99999);
  });
});

describe("checkAllSessionsLiveness", () => {
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

  it("assigns status and pid to all sessions", async () => {
    const sessions = [
      makeSession({
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        jsonlPath: path.join(
          MOCK_CLAUDE,
          "projects",
          "-Users-alice-projects-my-app",
          "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl",
        ),
      }),
      makeSession({
        id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        jsonlPath: null,
      }),
    ];

    const result = await checkAllSessionsLiveness(sessions, {
      claudeDir: MOCK_CLAUDE,
      recencyWindowSeconds: 0,
    });

    // All sessions should have a defined status
    for (const s of result) {
      expect(s.status).toBeDefined();
    }
  });

  it("returns the same array reference (mutation)", async () => {
    const sessions = [makeSession()];

    const result = await checkAllSessionsLiveness(sessions, {
      claudeDir: MOCK_CLAUDE,
    });

    expect(result).toBe(sessions);
  });

  it("handles empty array without error", async () => {
    const result = await checkAllSessionsLiveness([], {
      claudeDir: MOCK_CLAUDE,
    });

    expect(result).toEqual([]);
  });

  it("handles missing sessions directory gracefully", async () => {
    const sessions = [makeSession({ jsonlPath: null })];

    const result = await checkAllSessionsLiveness(sessions, {
      claudeDir: "/nonexistent/path",
    });

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("unknown");
  });

  it("batch assigns active status when PID is alive", async () => {
    killSpy.mockImplementation(((pid: number) => {
      if (pid === 99999) return true;
      const err = new Error("ESRCH") as NodeJS.ErrnoException;
      err.code = "ESRCH";
      throw err;
    }) as typeof process.kill);

    const sessions = [
      makeSession({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }),
      makeSession({
        id: "11111111-1111-1111-1111-111111111111",
        jsonlPath: null,
      }),
    ];

    const result = await checkAllSessionsLiveness(sessions, {
      claudeDir: MOCK_CLAUDE,
    });

    const active = result.find(
      (s) => s.id === "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    )!;
    expect(active.status).toBe("active");
    expect(active.pid).toBe(99999);

    // Second session has dead PID 88888, no JSONL
    const other = result.find(
      (s) => s.id === "11111111-1111-1111-1111-111111111111",
    )!;
    expect(other.status).toBe("unknown");
  });
});
