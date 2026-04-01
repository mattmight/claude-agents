import { describe, it, expect } from "vitest";
import { createColors } from "../../src/utils/colors.js";
import {
  formatProjectsTable,
  formatSessionsTable,
  statusIndicator,
  formatDate,
} from "../../src/formatters/table.js";
import type { ProjectRow } from "../../src/formatters/table.js";
import type { Session } from "../../src/types.js";

const noColors = createColors(false);

function makeProjectRow(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    path: "/Users/alice/projects/my-app",
    encodedDir: "-Users-alice-projects-my-app",
    sessionCount: 5,
    lastActive: new Date("2025-06-15T14:30:00Z"),
    status: "active",
    activeSessionCount: 1,
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    projectPath: "/Users/alice/projects/my-app",
    branch: "main",
    summary: "Test session",
    firstPrompt: "Hello",
    messageCount: 42,
    createdAt: new Date("2025-06-15T10:00:00Z"),
    updatedAt: new Date("2025-06-15T14:30:00Z"),
    jsonlPath: null,
    jsonlSizeBytes: 0,
    isSidechain: false,
    subAgents: [],
    source: "sessions-index",
    status: "active",
    pid: 12345,
    ...overrides,
  };
}

describe("formatDate", () => {
  it("formats a date as YYYY-MM-DD HH:MM", () => {
    // Use a date where we know the local representation
    const d = new Date(2025, 5, 15, 14, 30); // June 15 2025, 14:30 local
    expect(formatDate(d)).toBe("2025-06-15 14:30");
  });

  it("zero-pads single-digit months and minutes", () => {
    const d = new Date(2025, 0, 5, 9, 5); // Jan 5 2025, 09:05 local
    expect(formatDate(d)).toBe("2025-01-05 09:05");
  });
});

describe("statusIndicator", () => {
  it("returns green indicator for active", () => {
    const colors = createColors(true);
    const result = statusIndicator("active", colors);
    expect(result).toContain("\u25CF active");
    expect(result).toContain("\x1b[32m"); // green
  });

  it("returns yellow indicator for likely_active", () => {
    const colors = createColors(true);
    const result = statusIndicator("likely_active", colors);
    expect(result).toContain("\u25CE likely_active");
    expect(result).toContain("\x1b[33m"); // yellow
  });

  it("returns dim indicator for stopped", () => {
    const colors = createColors(true);
    const result = statusIndicator("stopped", colors);
    expect(result).toContain("\u25CB stopped");
    expect(result).toContain("\x1b[2m"); // dim
  });

  it("returns dim indicator for unknown", () => {
    const colors = createColors(true);
    const result = statusIndicator("unknown", colors);
    expect(result).toContain("? unknown");
  });

  it("returns dim indicator for undefined", () => {
    const result = statusIndicator(undefined, noColors);
    expect(result).toBe("? unknown");
  });
});

describe("formatProjectsTable", () => {
  it("renders header and data rows", () => {
    const rows = [makeProjectRow()];
    const output = formatProjectsTable(rows, noColors);
    expect(output).toContain("PROJECT PATH");
    expect(output).toContain("SESSIONS");
    expect(output).toContain("LAST ACTIVE");
    expect(output).toContain("STATUS");
    expect(output).toContain("/Users/alice/projects/my-app");
  });

  it("returns message for empty list", () => {
    const output = formatProjectsTable([], noColors);
    expect(output).toBe("No projects found.");
  });

  it("handles null lastActive", () => {
    const rows = [makeProjectRow({ lastActive: null })];
    const output = formatProjectsTable(rows, noColors);
    expect(output).toContain("-");
  });

  it("shows correct status indicators", () => {
    const rows = [
      makeProjectRow({ status: "active" }),
      makeProjectRow({ path: "/other", status: "stopped" }),
    ];
    const output = formatProjectsTable(rows, noColors);
    expect(output).toContain("\u25CF active");
    expect(output).toContain("\u25CB stopped");
  });
});

describe("formatSessionsTable", () => {
  it("renders header and data rows", () => {
    const sessions = [makeSession()];
    const output = formatSessionsTable(sessions, noColors);
    expect(output).toContain("SESSION ID");
    expect(output).toContain("PROJECT");
    expect(output).toContain("BRANCH");
    expect(output).toContain("STATUS");
    expect(output).toContain("UPDATED");
    expect(output).toContain("MSGS");
    expect(output).toContain("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });

  it("returns message for empty list", () => {
    const output = formatSessionsTable([], noColors);
    expect(output).toBe("No sessions found.");
  });

  it("handles null branch as empty string", () => {
    const sessions = [makeSession({ branch: null })];
    const output = formatSessionsTable(sessions, noColors);
    // Should not crash, branch column should be empty
    expect(output).toContain("SESSION ID");
  });

  it("handles null projectPath", () => {
    const sessions = [makeSession({ projectPath: null })];
    const output = formatSessionsTable(sessions, noColors);
    expect(output).toContain("(unknown)");
  });

  it("shows all four status types", () => {
    const sessions = [
      makeSession({ id: "a1", status: "active" }),
      makeSession({ id: "a2", status: "likely_active" }),
      makeSession({ id: "a3", status: "stopped" }),
      makeSession({ id: "a4", status: "unknown" }),
    ];
    const output = formatSessionsTable(sessions, noColors);
    expect(output).toContain("\u25CF active");
    expect(output).toContain("\u25CE likely_active");
    expect(output).toContain("\u25CB stopped");
    expect(output).toContain("? unknown");
  });
});
