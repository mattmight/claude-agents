import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server.js";
import { mkdir, writeFile, stat, rm } from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

async function createMcpTestDir(): Promise<{
  claudeDir: string;
  sessionId: string;
}> {
  const claudeDir = path.join(
    os.tmpdir(),
    `claude-agents-mcp-del-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const sessionId = "mcpdelete-cafe-1234-5678-abcdef012345";
  const encodedProject = "-tmp-mcp-del-project";
  const projectDir = path.join(claudeDir, "projects", encodedProject);
  await mkdir(projectDir, { recursive: true });

  const jsonlPath = path.join(projectDir, `${sessionId}.jsonl`);
  await writeFile(
    jsonlPath,
    `{"type":"user","message":{"content":"hello"},"timestamp":"2025-01-01T00:00:00Z","sessionId":"${sessionId}"}\n`,
  );

  const index = {
    version: 1,
    entries: [
      {
        sessionId,
        fullPath: jsonlPath,
        fileMtime: Date.now(),
        firstPrompt: "hello",
        summary: "MCP test",
        messageCount: 1,
        created: "2025-01-01T00:00:00Z",
        modified: "2025-01-01T00:00:01Z",
        gitBranch: "main",
        projectPath: "/tmp/mcp-del-project",
        isSidechain: false,
      },
    ],
    originalPath: "/tmp/mcp-del-project",
  };
  await writeFile(
    path.join(projectDir, "sessions-index.json"),
    JSON.stringify(index, null, 2),
  );

  return { claudeDir, sessionId };
}

describe("MCP delete tools", () => {
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

  it("delete_session tool lists all 7 tools", async () => {
    const { claudeDir } = await createMcpTestDir();
    try {
      const server = createMcpServer({ claudeDir });
      const client = new Client({ name: "test", version: "1.0.0" });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await server.connect(st);
      await client.connect(ct);

      const result = await client.listTools();
      const names = result.tools.map((t) => t.name);
      expect(names).toContain("delete_session");
      expect(names).toContain("bulk_delete_sessions");
      expect(result.tools).toHaveLength(7);

      await client.close();
    } finally {
      await rm(claudeDir, { recursive: true, force: true });
    }
  });

  it("delete_session dry_run returns plan", async () => {
    const { claudeDir, sessionId } = await createMcpTestDir();
    try {
      const server = createMcpServer({ claudeDir });
      const client = new Client({ name: "test", version: "1.0.0" });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await server.connect(st);
      await client.connect(ct);

      const result = await client.callTool({
        name: "delete_session",
        arguments: { session_id: sessionId, dry_run: true },
      });
      expect(result.isError).toBeFalsy();

      const content = result.content as { type: string; text: string }[];
      const data = JSON.parse(content[0].text);
      expect(data.sessionId).toBe(sessionId);
      expect(data.targets.length).toBeGreaterThan(0);

      // File should still exist
      const jsonlPath = path.join(
        claudeDir,
        "projects",
        "-tmp-mcp-del-project",
        `${sessionId}.jsonl`,
      );
      await expect(stat(jsonlPath)).resolves.toBeDefined();

      await client.close();
    } finally {
      await rm(claudeDir, { recursive: true, force: true });
    }
  });

  it("delete_session removes session files", async () => {
    const { claudeDir, sessionId } = await createMcpTestDir();
    try {
      const server = createMcpServer({ claudeDir });
      const client = new Client({ name: "test", version: "1.0.0" });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await server.connect(st);
      await client.connect(ct);

      const result = await client.callTool({
        name: "delete_session",
        arguments: { session_id: sessionId },
      });
      expect(result.isError).toBeFalsy();

      const content = result.content as { type: string; text: string }[];
      const data = JSON.parse(content[0].text);
      expect(data.deleted.length).toBeGreaterThan(0);

      // File should be gone
      const jsonlPath = path.join(
        claudeDir,
        "projects",
        "-tmp-mcp-del-project",
        `${sessionId}.jsonl`,
      );
      await expect(stat(jsonlPath)).rejects.toThrow();

      await client.close();
    } finally {
      await rm(claudeDir, { recursive: true, force: true });
    }
  });

  it("delete_session returns error for nonexistent ID", async () => {
    const { claudeDir } = await createMcpTestDir();
    try {
      const server = createMcpServer({ claudeDir });
      const client = new Client({ name: "test", version: "1.0.0" });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await server.connect(st);
      await client.connect(ct);

      const result = await client.callTool({
        name: "delete_session",
        arguments: { session_id: "nonexistent" },
      });
      expect(result.isError).toBe(true);

      await client.close();
    } finally {
      await rm(claudeDir, { recursive: true, force: true });
    }
  });

  it("bulk_delete_sessions dry_run lists matching sessions", async () => {
    const { claudeDir } = await createMcpTestDir();
    try {
      const server = createMcpServer({ claudeDir });
      const client = new Client({ name: "test", version: "1.0.0" });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await server.connect(st);
      await client.connect(ct);

      const result = await client.callTool({
        name: "bulk_delete_sessions",
        arguments: { all_stopped: true, dry_run: true },
      });
      expect(result.isError).toBeFalsy();

      const content = result.content as { type: string; text: string }[];
      const data = JSON.parse(content[0].text);
      expect(typeof data.count).toBe("number");
      expect(Array.isArray(data.sessions)).toBe(true);

      await client.close();
    } finally {
      await rm(claudeDir, { recursive: true, force: true });
    }
  });
});
