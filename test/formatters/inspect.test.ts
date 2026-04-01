import { describe, it, expect } from "vitest";
import { createColors } from "../../src/utils/colors.js";
import {
  formatInspectDetail,
  formatInspectJson,
} from "../../src/formatters/inspect.js";
import type { Session } from "../../src/types.js";

const noColors = createColors(false);

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    projectPath: "/Users/alice/projects/my-app",
    branch: "feat/fhir",
    summary: "Implementing FHIR R4 patient resource transformer",
    firstPrompt: "Hello",
    messageCount: 42,
    createdAt: new Date("2025-06-15T10:00:00Z"),
    updatedAt: new Date("2025-06-15T14:30:00Z"),
    jsonlPath: "/path/to/session.jsonl",
    jsonlSizeBytes: 2400000,
    isSidechain: false,
    subAgents: [
      {
        agentId: "a980ab1",
        jsonlPath: "/path/to/agent-a980ab1.jsonl",
        agentType: "research",
        description: "Research agent",
      },
      {
        agentId: "f3c2d1e",
        jsonlPath: "/path/to/agent-f3c2d1e.jsonl",
        agentType: null,
        description: null,
      },
    ],
    source: "sessions-index",
    status: "active",
    pid: 48291,
    ...overrides,
  };
}

describe("formatInspectDetail", () => {
  it("shows all key fields", () => {
    const output = formatInspectDetail(makeSession(), noColors);
    expect(output).toContain("Session:");
    expect(output).toContain("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(output).toContain("Project:");
    expect(output).toContain("/Users/alice/projects/my-app");
    expect(output).toContain("Branch:");
    expect(output).toContain("feat/fhir");
    expect(output).toContain("Status:");
    expect(output).toContain("Messages:");
    expect(output).toContain("42");
  });

  it("shows PID when active", () => {
    const output = formatInspectDetail(makeSession(), noColors);
    expect(output).toContain("PID 48291");
  });

  it("shows summary when available", () => {
    const output = formatInspectDetail(makeSession(), noColors);
    expect(output).toContain("Summary:");
    expect(output).toContain("FHIR R4");
  });

  it("omits summary when null", () => {
    const output = formatInspectDetail(
      makeSession({ summary: null }),
      noColors,
    );
    expect(output).not.toContain("Summary:");
  });

  it("shows JSONL size in human-readable format", () => {
    const output = formatInspectDetail(makeSession(), noColors);
    expect(output).toContain("JSONL Size:");
    expect(output).toContain("2.3 MB");
  });

  it("shows sub-agents", () => {
    const output = formatInspectDetail(makeSession(), noColors);
    expect(output).toContain("Sub-agents:");
    expect(output).toContain("agent-a980ab1");
    expect(output).toContain("agent-f3c2d1e");
  });

  it("omits sub-agents line when none", () => {
    const output = formatInspectDetail(
      makeSession({ subAgents: [] }),
      noColors,
    );
    expect(output).not.toContain("Sub-agents:");
  });

  it("handles null projectPath", () => {
    const output = formatInspectDetail(
      makeSession({ projectPath: null }),
      noColors,
    );
    expect(output).toContain("(unknown)");
  });

  it("handles null branch", () => {
    const output = formatInspectDetail(
      makeSession({ branch: null }),
      noColors,
    );
    expect(output).toContain("(none)");
  });
});

describe("formatInspectJson", () => {
  it("returns valid JSON", () => {
    const output = formatInspectJson(makeSession());
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it("includes all fields with snake_case keys", () => {
    const output = formatInspectJson(makeSession());
    const parsed = JSON.parse(output);
    expect(parsed.id).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(parsed.project_path).toBe("/Users/alice/projects/my-app");
    expect(parsed.status).toBe("active");
    expect(parsed.pid).toBe(48291);
    expect(parsed.message_count).toBe(42);
  });

  it("includes sub_agents array", () => {
    const output = formatInspectJson(makeSession());
    const parsed = JSON.parse(output);
    expect(parsed.sub_agents).toHaveLength(2);
    expect(parsed.sub_agents[0].agent_id).toBe("a980ab1");
    expect(parsed.sub_agents[0].agent_type).toBe("research");
  });
});
