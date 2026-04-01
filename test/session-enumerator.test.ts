import { describe, it, expect } from "vitest";
import {
  enumerateProjectSessions,
  enumerateAllSessions,
  discoverSubAgents,
} from "../src/core/session-enumerator.js";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, "fixtures");
const MOCK_CLAUDE = path.join(FIXTURES, "mock-claude-dir");
const PROJECTS = path.join(MOCK_CLAUDE, "projects");

describe("enumerateProjectSessions", () => {
  it("enumerates sessions from sessions-index.json", async () => {
    const sessions = await enumerateProjectSessions(
      path.join(PROJECTS, "-Users-alice-projects-my-app"),
      "/Users/alice/projects/my-app",
    );
    expect(sessions).toHaveLength(2);

    const ids = sessions.map((s) => s.id);
    expect(ids).toContain("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(ids).toContain("bbbbbbbb-1111-2222-3333-444444444444");
  });

  it("populates correct fields from sessions-index.json", async () => {
    const sessions = await enumerateProjectSessions(
      path.join(PROJECTS, "-Users-alice-projects-my-app"),
      "/Users/alice/projects/my-app",
    );

    const session = sessions.find(
      (s) => s.id === "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    )!;
    expect(session.summary).toBe("Test session");
    expect(session.firstPrompt).toBe("Hello");
    expect(session.messageCount).toBe(3);
    expect(session.branch).toBe("main");
    expect(session.projectPath).toBe("/Users/alice/projects/my-app");
    expect(session.source).toBe("sessions-index");
    expect(session.isSidechain).toBe(false);
    expect(session.createdAt).toEqual(new Date("2025-01-01T00:00:00.000Z"));
    expect(session.updatedAt).toEqual(new Date("2025-01-01T00:05:00.000Z"));
  });

  it("sorts sessions by updatedAt descending", async () => {
    const sessions = await enumerateProjectSessions(
      path.join(PROJECTS, "-Users-alice-projects-my-app"),
      "/Users/alice/projects/my-app",
    );
    expect(sessions[0].id).toBe("bbbbbbbb-1111-2222-3333-444444444444");
    expect(sessions[1].id).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });

  it("returns empty array for project with empty sessions-index entries", async () => {
    const sessions = await enumerateProjectSessions(
      path.join(PROJECTS, "-Users-alice-projects-my-dotted-project"),
      "/Users/alice/projects/my.dotted.project",
    );
    expect(sessions).toEqual([]);
  });

  it("falls back to JSONL scan when sessions-index.json is missing", async () => {
    const sessions = await enumerateProjectSessions(
      path.join(PROJECTS, "-Users-alice-code-orphan-project"),
      "/Users/alice/code/orphan-project",
    );
    expect(sessions).toHaveLength(1);

    const session = sessions[0];
    expect(session.id).toBe("11111111-2222-3333-4444-555555555555");
    expect(session.source).toBe("jsonl-scan");
  });

  it("counts only user/assistant/system types in JSONL scan", async () => {
    const sessions = await enumerateProjectSessions(
      path.join(PROJECTS, "-Users-alice-code-orphan-project"),
      "/Users/alice/code/orphan-project",
    );
    // 1 system + 2 user + 1 assistant = 4 (progress does NOT count)
    expect(sessions[0].messageCount).toBe(4);
  });

  it("extracts first user prompt from JSONL scan", async () => {
    const sessions = await enumerateProjectSessions(
      path.join(PROJECTS, "-Users-alice-code-orphan-project"),
      "/Users/alice/code/orphan-project",
    );
    expect(sessions[0].firstPrompt).toBe("Fix the bug");
  });

  it("extracts timestamps from JSONL scan", async () => {
    const sessions = await enumerateProjectSessions(
      path.join(PROJECTS, "-Users-alice-code-orphan-project"),
      "/Users/alice/code/orphan-project",
    );
    expect(sessions[0].createdAt).toEqual(
      new Date("2025-02-01T12:00:00.000Z"),
    );
    expect(sessions[0].updatedAt).toEqual(
      new Date("2025-02-01T12:01:00.000Z"),
    );
  });

  it("converts empty gitBranch to null", async () => {
    const sessions = await enumerateProjectSessions(
      path.join(PROJECTS, "-Users-alice-code-orphan-project"),
      "/Users/alice/code/orphan-project",
    );
    expect(sessions[0].branch).toBeNull();
  });

  it("populates jsonlSizeBytes from JSONL scan", async () => {
    const sessions = await enumerateProjectSessions(
      path.join(PROJECTS, "-Users-alice-code-orphan-project"),
      "/Users/alice/code/orphan-project",
    );
    expect(sessions[0].jsonlSizeBytes).toBeGreaterThan(0);
  });

  it("has no summary for JSONL-scanned sessions", async () => {
    const sessions = await enumerateProjectSessions(
      path.join(PROJECTS, "-Users-alice-code-orphan-project"),
      "/Users/alice/code/orphan-project",
    );
    expect(sessions[0].summary).toBeNull();
  });

  it("returns empty array for project with no sessions", async () => {
    const sessions = await enumerateProjectSessions(
      path.join(PROJECTS, "-Users-alice-unknown-thing"),
      null,
    );
    expect(sessions).toEqual([]);
  });

  it("discovers sub-agents and associates them with sessions", async () => {
    const sessions = await enumerateProjectSessions(
      path.join(PROJECTS, "-Users-alice-projects-my-app"),
      "/Users/alice/projects/my-app",
    );
    const session = sessions.find(
      (s) => s.id === "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    )!;
    expect(session.subAgents).toHaveLength(1);
    expect(session.subAgents[0].agentId).toBe("a1b2c3d");
    expect(session.subAgents[0].agentType).toBe("Explore");
    expect(session.subAgents[0].description).toBe("Explore codebase structure");
  });
});

describe("discoverSubAgents", () => {
  it("discovers sub-agents with meta.json", async () => {
    const agents = await discoverSubAgents(
      path.join(PROJECTS, "-Users-alice-projects-my-app"),
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
    expect(agents).toHaveLength(1);
    expect(agents[0].agentId).toBe("a1b2c3d");
    expect(agents[0].agentType).toBe("Explore");
    expect(agents[0].description).toBe("Explore codebase structure");
    expect(agents[0].jsonlPath).toContain("agent-a1b2c3d.jsonl");
  });

  it("returns empty array when session has no subagents directory", async () => {
    const agents = await discoverSubAgents(
      path.join(PROJECTS, "-Users-alice-code-orphan-project"),
      "11111111-2222-3333-4444-555555555555",
    );
    expect(agents).toEqual([]);
  });

  it("returns empty array for nonexistent session", async () => {
    const agents = await discoverSubAgents(
      path.join(PROJECTS, "-Users-alice-projects-my-app"),
      "nonexistent-session-id",
    );
    expect(agents).toEqual([]);
  });
});

describe("enumerateAllSessions", () => {
  it("enumerates sessions across all projects", async () => {
    const sessions = await enumerateAllSessions({ claudeDir: MOCK_CLAUDE });
    // my-app has 2 sessions (from index), orphan has 1 (from scan)
    expect(sessions.length).toBeGreaterThanOrEqual(3);

    const ids = sessions.map((s) => s.id);
    expect(ids).toContain("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(ids).toContain("bbbbbbbb-1111-2222-3333-444444444444");
    expect(ids).toContain("11111111-2222-3333-4444-555555555555");
  });

  it("sorts all sessions by updatedAt descending", async () => {
    const sessions = await enumerateAllSessions({ claudeDir: MOCK_CLAUDE });
    for (let i = 1; i < sessions.length; i++) {
      expect(sessions[i - 1].updatedAt.getTime()).toBeGreaterThanOrEqual(
        sessions[i].updatedAt.getTime(),
      );
    }
  });

  it("returns empty array when no projects exist", async () => {
    const sessions = await enumerateAllSessions({
      claudeDir: path.join(FIXTURES, "empty-claude-dir"),
    });
    expect(sessions).toEqual([]);
  });
});
