import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { scanSessions, diffAndEmit } from "../../src/commands/watch.js";
import type { Session } from "../../src/types.js";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, "..", "fixtures");
const MOCK_CLAUDE = path.join(FIXTURES, "mock-claude-dir");

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    projectPath: "/Users/alice/projects/my-app",
    branch: "main",
    summary: null,
    firstPrompt: null,
    messageCount: 5,
    createdAt: new Date("2025-06-15T10:00:00Z"),
    updatedAt: new Date("2025-06-15T14:30:00Z"),
    jsonlPath: null,
    jsonlSizeBytes: 0,
    isSidechain: false,
    subAgents: [],
    source: "sessions-index",
    status: "stopped",
    pid: null,
    ...overrides,
  };
}

describe("scanSessions", () => {
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

  it("returns sessions with liveness status", async () => {
    const sessions = await scanSessions({ claudeDir: MOCK_CLAUDE });
    expect(sessions.length).toBeGreaterThan(0);
    for (const s of sessions) {
      expect(s.status).toBeDefined();
    }
  });
});

describe("diffAndEmit", () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let emittedLines: string[];

  beforeEach(() => {
    emittedLines = [];
    writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        emittedLines.push(String(chunk));
        return true;
      });
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it("emits session_started for new sessions", () => {
    const prev = new Map();
    const sessions = [makeSession({ id: "new-session", status: "active" })];

    diffAndEmit(sessions, prev);

    const events = emittedLines
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("session_started");
    expect(events[0].session.id).toBe("new-session");
  });

  it("emits status_changed when status differs", () => {
    const prev = new Map([
      ["s1", { status: "active", updatedAt: 1000 }],
    ]);
    const sessions = [
      makeSession({ id: "s1", status: "stopped", updatedAt: new Date(1000) }),
    ];

    diffAndEmit(sessions, prev);

    const events = emittedLines
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("status_changed");
    expect(events[0].previous_status).toBe("active");
  });

  it("emits session_updated when updatedAt changes", () => {
    const prev = new Map([
      ["s1", { status: "active", updatedAt: 1000 }],
    ]);
    const sessions = [
      makeSession({ id: "s1", status: "active", updatedAt: new Date(2000) }),
    ];

    diffAndEmit(sessions, prev);

    const events = emittedLines
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("session_updated");
  });

  it("emits session_stopped for disappeared sessions", () => {
    const prev = new Map([
      ["gone-session", { status: "active", updatedAt: 1000 }],
    ]);
    const sessions: Session[] = [];

    diffAndEmit(sessions, prev);

    const events = emittedLines
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("session_stopped");
    expect(events[0].session.id).toBe("gone-session");
  });

  it("emits nothing when no changes", () => {
    const prev = new Map([
      ["s1", { status: "active", updatedAt: 1000 }],
    ]);
    const sessions = [
      makeSession({ id: "s1", status: "active", updatedAt: new Date(1000) }),
    ];

    diffAndEmit(sessions, prev);

    const events = emittedLines
      .map((l) => l.trim())
      .filter(Boolean);
    expect(events).toHaveLength(0);
  });

  it("returns updated snapshot map", () => {
    const prev = new Map();
    const sessions = [makeSession({ id: "s1", status: "active" })];

    const next = diffAndEmit(sessions, prev);
    expect(next.has("s1")).toBe(true);
    expect(next.get("s1")!.status).toBe("active");
  });

  it("emits valid NDJSON", () => {
    const prev = new Map();
    const sessions = [makeSession({ id: "s1", status: "active" })];

    diffAndEmit(sessions, prev);

    for (const line of emittedLines) {
      const trimmed = line.trim();
      if (trimmed) {
        expect(() => JSON.parse(trimmed)).not.toThrow();
      }
    }
  });
});
