import { describe, it, expect } from "vitest";
import { formatProjectsJson, formatSessionsJson } from "../../src/formatters/json.js";
import type { ProjectRow } from "../../src/formatters/table.js";
import type { Session } from "../../src/types.js";

function makeProjectRow(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    path: "/Users/alice/projects/my-app",
    encodedDir: "-Users-alice-projects-my-app",
    sessionCount: 5,
    lastActive: new Date("2025-06-15T14:30:00.000Z"),
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
    createdAt: new Date("2025-06-15T10:00:00.000Z"),
    updatedAt: new Date("2025-06-15T14:30:00.000Z"),
    jsonlPath: "/path/to/session.jsonl",
    jsonlSizeBytes: 1024,
    isSidechain: false,
    subAgents: [],
    source: "sessions-index",
    status: "active",
    pid: 12345,
    ...overrides,
  };
}

describe("formatProjectsJson", () => {
  it("returns valid JSON", () => {
    const output = formatProjectsJson([makeProjectRow()]);
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it("uses snake_case keys", () => {
    const output = formatProjectsJson([makeProjectRow()]);
    const parsed = JSON.parse(output);
    expect(parsed[0]).toHaveProperty("encoded_dir");
    expect(parsed[0]).toHaveProperty("session_count");
    expect(parsed[0]).toHaveProperty("last_active");
    expect(parsed[0]).toHaveProperty("active_sessions");
  });

  it("formats dates as ISO 8601", () => {
    const output = formatProjectsJson([makeProjectRow()]);
    const parsed = JSON.parse(output);
    expect(parsed[0].last_active).toBe("2025-06-15T14:30:00.000Z");
  });

  it("handles null lastActive", () => {
    const output = formatProjectsJson([makeProjectRow({ lastActive: null })]);
    const parsed = JSON.parse(output);
    expect(parsed[0].last_active).toBeNull();
  });

  it("returns empty array for empty input", () => {
    const output = formatProjectsJson([]);
    expect(output).toBe("[]");
  });
});

describe("formatSessionsJson", () => {
  it("returns valid JSON", () => {
    const output = formatSessionsJson([makeSession()]);
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it("uses snake_case keys", () => {
    const output = formatSessionsJson([makeSession()]);
    const parsed = JSON.parse(output);
    expect(parsed[0]).toHaveProperty("project_path");
    expect(parsed[0]).toHaveProperty("updated_at");
    expect(parsed[0]).toHaveProperty("created_at");
    expect(parsed[0]).toHaveProperty("message_count");
    expect(parsed[0]).toHaveProperty("first_prompt");
    expect(parsed[0]).toHaveProperty("jsonl_path");
    expect(parsed[0]).toHaveProperty("jsonl_size_bytes");
    expect(parsed[0]).toHaveProperty("is_sidechain");
  });

  it("includes all required fields", () => {
    const output = formatSessionsJson([makeSession()]);
    const parsed = JSON.parse(output);
    const s = parsed[0];
    expect(s.id).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(s.project_path).toBe("/Users/alice/projects/my-app");
    expect(s.branch).toBe("main");
    expect(s.status).toBe("active");
    expect(s.message_count).toBe(42);
    expect(s.pid).toBe(12345);
  });

  it("returns empty array for empty input", () => {
    const output = formatSessionsJson([]);
    expect(output).toBe("[]");
  });
});
