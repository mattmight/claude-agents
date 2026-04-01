import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createColors } from "../src/utils/colors.js";
import { runProjectsCommand } from "../src/commands/projects.js";
import { runSessionsCommand } from "../src/commands/sessions.js";
import { runStatusCommand } from "../src/commands/status.js";
import { runInspectCommand } from "../src/commands/inspect.js";
import { enumerateAllSessions } from "../src/core/session-enumerator.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server.js";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, "fixtures");
const EMPTY_CLAUDE = path.join(FIXTURES, "empty-claude-dir");
const CORRUPTED_CLAUDE = path.join(FIXTURES, "corrupted-claude-dir");

const noColors = createColors(false);

describe("Edge cases: empty ~/.claude/ directory", () => {
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

  it("projects command returns 'No projects found.'", async () => {
    const { output } = await runProjectsCommand(
      { claudeDir: EMPTY_CLAUDE },
      noColors,
    );
    expect(output).toBe("No projects found.");
  });

  it("sessions command returns 'No sessions found.'", async () => {
    const { output } = await runSessionsCommand(
      undefined,
      { claudeDir: EMPTY_CLAUDE },
      noColors,
    );
    expect(output).toBe("No sessions found.");
  });

  it("sessions --json returns empty array", async () => {
    const { output } = await runSessionsCommand(
      undefined,
      { claudeDir: EMPTY_CLAUDE, json: true },
      noColors,
    );
    expect(output).toBe("[]");
  });

  it("status command shows zero counts", async () => {
    const output = await runStatusCommand(
      { claudeDir: EMPTY_CLAUDE },
      noColors,
    );
    expect(output).toContain("Projects:       0");
    expect(output).toContain("Total sessions: 0");
  });

  it("status --json returns zero counts", async () => {
    const output = await runStatusCommand(
      { claudeDir: EMPTY_CLAUDE, json: true },
      noColors,
    );
    const data = JSON.parse(output);
    expect(data.project_count).toBe(0);
    expect(data.total_sessions).toBe(0);
  });
});

describe("Edge cases: nonexistent ~/.claude/ directory", () => {
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

  it("projects returns empty gracefully", async () => {
    const { output } = await runProjectsCommand(
      { claudeDir: "/nonexistent/path/to/claude" },
      noColors,
    );
    expect(output).toBe("No projects found.");
  });

  it("sessions returns empty gracefully", async () => {
    const { output } = await runSessionsCommand(
      undefined,
      { claudeDir: "/nonexistent/path/to/claude", json: true },
      noColors,
    );
    expect(output).toBe("[]");
  });

  it("status returns zero gracefully", async () => {
    const output = await runStatusCommand(
      { claudeDir: "/nonexistent/path/to/claude", json: true },
      noColors,
    );
    const data = JSON.parse(output);
    expect(data.project_count).toBe(0);
  });
});

describe("Edge cases: corrupted sessions-index.json", () => {
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

  it("skips corrupted sessions-index.json without crashing", async () => {
    const sessions = await enumerateAllSessions({
      claudeDir: CORRUPTED_CLAUDE,
    });
    // Should not throw — corrupted index is skipped, falls back to JSONL scan
    expect(Array.isArray(sessions)).toBe(true);
  });

  it("projects command handles corrupted index gracefully", async () => {
    const { output } = await runProjectsCommand(
      { claudeDir: CORRUPTED_CLAUDE },
      noColors,
    );
    // Should produce output (project discovered but sessions may be 0)
    expect(typeof output).toBe("string");
  });
});

describe("Edge cases: inspect with invalid IDs", () => {
  let killSpy: ReturnType<typeof vi.spyOn>;
  const MOCK_CLAUDE = path.join(FIXTURES, "mock-claude-dir");

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

  it("rejects empty session ID", async () => {
    await expect(
      runInspectCommand("", { claudeDir: MOCK_CLAUDE }, noColors),
    ).rejects.toThrow();
  });

  it("rejects completely invalid prefix", async () => {
    await expect(
      runInspectCommand(
        "zzzzzzzz-not-a-session",
        { claudeDir: MOCK_CLAUDE },
        noColors,
      ),
    ).rejects.toThrow(/No session found/);
  });
});

describe("Edge cases: MCP server with empty data", () => {
  let client: Client;
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      const err = new Error("ESRCH") as NodeJS.ErrnoException;
      err.code = "ESRCH";
      throw err;
    });

    const server = createMcpServer({ claudeDir: EMPTY_CLAUDE });
    client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    killSpy.mockRestore();
  });

  it("list_projects returns empty array", async () => {
    const result = await client.callTool({
      name: "list_projects",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
    const content = result.content as { type: string; text: string }[];
    expect(JSON.parse(content[0].text)).toEqual([]);
  });

  it("list_sessions returns empty array", async () => {
    const result = await client.callTool({
      name: "list_sessions",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
    const content = result.content as { type: string; text: string }[];
    expect(JSON.parse(content[0].text)).toEqual([]);
  });

  it("get_status returns zero counts", async () => {
    const result = await client.callTool({
      name: "get_status",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
    const content = result.content as { type: string; text: string }[];
    const data = JSON.parse(content[0].text);
    expect(data.project_count).toBe(0);
    expect(data.total_sessions).toBe(0);
  });

  it("inspect_session returns error for nonexistent ID", async () => {
    const result = await client.callTool({
      name: "inspect_session",
      arguments: { session_id: "nonexistent" },
    });
    expect(result.isError).toBe(true);
  });

  it("find_session returns empty for any query", async () => {
    const result = await client.callTool({
      name: "find_session",
      arguments: { query: "anything" },
    });
    expect(result.isError).toBeFalsy();
    const content = result.content as { type: string; text: string }[];
    expect(JSON.parse(content[0].text)).toEqual([]);
  });

  it("resources/list returns resources even with empty data", async () => {
    const result = await client.listResources();
    expect(result.resources.length).toBeGreaterThanOrEqual(2); // at least static ones
  });
});
