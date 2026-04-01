import { describe, it, expect } from "vitest";
import { formatSessionsCsv } from "../../src/formatters/csv.js";
import type { Session } from "../../src/types.js";

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

describe("formatSessionsCsv", () => {
  it("includes header row", () => {
    const output = formatSessionsCsv([]);
    expect(output).toBe(
      "id,project_path,branch,status,updated_at,created_at,message_count,summary",
    );
  });

  it("includes data rows", () => {
    const output = formatSessionsCsv([makeSession()]);
    const lines = output.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(lines[1]).toContain("/Users/alice/projects/my-app");
    expect(lines[1]).toContain("active");
    expect(lines[1]).toContain("42");
  });

  it("formats dates as ISO 8601", () => {
    const output = formatSessionsCsv([makeSession()]);
    expect(output).toContain("2025-06-15T14:30:00.000Z");
    expect(output).toContain("2025-06-15T10:00:00.000Z");
  });

  it("quotes fields containing commas", () => {
    const output = formatSessionsCsv([
      makeSession({ summary: "Fix bug, refactor code" }),
    ]);
    expect(output).toContain('"Fix bug, refactor code"');
  });

  it("escapes double quotes inside fields", () => {
    const output = formatSessionsCsv([
      makeSession({ summary: 'He said "hello"' }),
    ]);
    expect(output).toContain('"He said ""hello"""');
  });

  it("handles null fields as empty strings", () => {
    const output = formatSessionsCsv([
      makeSession({ branch: null, summary: null }),
    ]);
    const lines = output.split("\n");
    // Branch and summary columns should be empty
    const fields = lines[1].split(",");
    expect(fields[2]).toBe(""); // branch
    expect(fields[7]).toBe(""); // summary
  });

  it("handles multiple sessions", () => {
    const output = formatSessionsCsv([
      makeSession({ id: "aaa" }),
      makeSession({ id: "bbb" }),
    ]);
    const lines = output.split("\n");
    expect(lines).toHaveLength(3);
  });
});
