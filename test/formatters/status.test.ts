import { describe, it, expect } from "vitest";
import { createColors } from "../../src/utils/colors.js";
import {
  formatStatusDashboard,
  formatStatusJson,
} from "../../src/formatters/status.js";
import type { StatusData } from "../../src/commands/status.js";
import type { Session } from "../../src/types.js";

const noColors = createColors(false);

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    projectPath: "/Users/alice/projects/my-app",
    branch: "main",
    summary: null,
    firstPrompt: null,
    messageCount: 42,
    createdAt: new Date("2025-06-15T10:00:00Z"),
    updatedAt: new Date("2025-06-15T14:30:00Z"),
    jsonlPath: null,
    jsonlSizeBytes: 0,
    isSidechain: false,
    subAgents: [],
    source: "sessions-index",
    status: "active",
    pid: 48291,
    ...overrides,
  };
}

function makeStatusData(overrides: Partial<StatusData> = {}): StatusData {
  return {
    projectCount: 14,
    totalSessions: 187,
    activeSessions: 3,
    last24hSessions: 12,
    activeSessionList: [
      makeSession({ status: "active", pid: 48291 }),
      makeSession({
        id: "bbbb",
        projectPath: "/Users/alice/projects/other",
        branch: "dev",
        status: "likely_active",
        pid: null,
        messageCount: 7,
      }),
    ],
    ...overrides,
  };
}

describe("formatStatusDashboard", () => {
  it("shows title and separator", () => {
    const output = formatStatusDashboard(makeStatusData(), noColors);
    expect(output).toContain("Claude Code Sessions");
    expect(output).toContain("\u2501");
  });

  it("shows aggregate counts", () => {
    const output = formatStatusDashboard(makeStatusData(), noColors);
    expect(output).toContain("Projects:       14");
    expect(output).toContain("Total sessions: 187");
    expect(output).toContain("Active:         3");
    expect(output).toContain("Last 24h:       12");
  });

  it("shows active sessions list", () => {
    const output = formatStatusDashboard(makeStatusData(), noColors);
    expect(output).toContain("Active Sessions:");
    expect(output).toContain("/Users/alice/projects/my-app");
    expect(output).toContain("42 msgs");
    expect(output).toContain("PID 48291");
  });

  it("shows (no PID) for likely_active sessions", () => {
    const output = formatStatusDashboard(makeStatusData(), noColors);
    expect(output).toContain("(no PID)");
  });

  it("omits active sessions section when none", () => {
    const output = formatStatusDashboard(
      makeStatusData({ activeSessions: 0, activeSessionList: [] }),
      noColors,
    );
    expect(output).not.toContain("Active Sessions:");
  });

  it("handles zero state", () => {
    const output = formatStatusDashboard(
      makeStatusData({
        projectCount: 0,
        totalSessions: 0,
        activeSessions: 0,
        last24hSessions: 0,
        activeSessionList: [],
      }),
      noColors,
    );
    expect(output).toContain("Projects:       0");
    expect(output).toContain("Total sessions: 0");
  });
});

describe("formatStatusJson", () => {
  it("returns valid JSON", () => {
    const output = formatStatusJson(makeStatusData());
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it("uses snake_case keys", () => {
    const output = formatStatusJson(makeStatusData());
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("project_count");
    expect(parsed).toHaveProperty("total_sessions");
    expect(parsed).toHaveProperty("active_sessions");
    expect(parsed).toHaveProperty("last_24h_sessions");
    expect(parsed).toHaveProperty("active_session_list");
  });

  it("includes active session details", () => {
    const output = formatStatusJson(makeStatusData());
    const parsed = JSON.parse(output);
    expect(parsed.active_session_list).toHaveLength(2);
    expect(parsed.active_session_list[0]).toHaveProperty("id");
    expect(parsed.active_session_list[0]).toHaveProperty("project_path");
    expect(parsed.active_session_list[0]).toHaveProperty("pid");
  });
});
