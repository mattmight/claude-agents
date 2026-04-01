import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server.js";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, "fixtures");
const MOCK_CLAUDE = path.join(FIXTURES, "mock-claude-dir");

describe("MCP Server Integration", () => {
  let client: Client;
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      const err = new Error("ESRCH") as NodeJS.ErrnoException;
      err.code = "ESRCH";
      throw err;
    });

    const server = createMcpServer({ claudeDir: MOCK_CLAUDE });
    client = new Client({ name: "test-client", version: "1.0.0" });

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    killSpy.mockRestore();
  });

  describe("listTools", () => {
    it("returns all five tools", async () => {
      const result = await client.listTools();
      const names = result.tools.map((t) => t.name);
      expect(names).toContain("list_projects");
      expect(names).toContain("list_sessions");
      expect(names).toContain("inspect_session");
      expect(names).toContain("get_status");
      expect(names).toContain("find_session");
      expect(result.tools).toHaveLength(5);
    });

    it("each tool has a description", async () => {
      const result = await client.listTools();
      for (const tool of result.tools) {
        expect(tool.description).toBeTruthy();
      }
    });

    it("each tool has an inputSchema", async () => {
      const result = await client.listTools();
      for (const tool of result.tools) {
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe("object");
      }
    });
  });

  describe("list_projects", () => {
    it("returns projects from fixture data", async () => {
      const result = await client.callTool({
        name: "list_projects",
        arguments: {},
      });
      expect(result.isError).toBeFalsy();
      const content = result.content as { type: string; text: string }[];
      const data = JSON.parse(content[0].text);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty("path");
      expect(data[0]).toHaveProperty("session_count");
      expect(data[0]).toHaveProperty("status");
    });

    it("filters active only", async () => {
      const result = await client.callTool({
        name: "list_projects",
        arguments: { active_only: true },
      });
      const content = result.content as { type: string; text: string }[];
      const data = JSON.parse(content[0].text);
      for (const p of data) {
        expect(p.status).toBe("active");
      }
    });

    it("sorts by session_count", async () => {
      const result = await client.callTool({
        name: "list_projects",
        arguments: { sort_by: "session_count" },
      });
      const content = result.content as { type: string; text: string }[];
      const data = JSON.parse(content[0].text);
      if (data.length > 1) {
        for (let i = 1; i < data.length; i++) {
          expect(data[i - 1].session_count).toBeGreaterThanOrEqual(
            data[i].session_count,
          );
        }
      }
    });
  });

  describe("list_sessions", () => {
    it("returns sessions from fixture data", async () => {
      const result = await client.callTool({
        name: "list_sessions",
        arguments: {},
      });
      expect(result.isError).toBeFalsy();
      const content = result.content as { type: string; text: string }[];
      const data = JSON.parse(content[0].text);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty("id");
      expect(data[0]).toHaveProperty("project_path");
      expect(data[0]).toHaveProperty("status");
    });

    it("filters by project_path", async () => {
      const result = await client.callTool({
        name: "list_sessions",
        arguments: { project_path: "my-app" },
      });
      const content = result.content as { type: string; text: string }[];
      const data = JSON.parse(content[0].text);
      for (const s of data) {
        expect(s.project_path.toLowerCase()).toContain("my-app");
      }
    });

    it("filters active_only", async () => {
      const result = await client.callTool({
        name: "list_sessions",
        arguments: { active_only: true },
      });
      const content = result.content as { type: string; text: string }[];
      const data = JSON.parse(content[0].text);
      for (const s of data) {
        expect(["active", "likely_active"]).toContain(s.status);
      }
    });

    it("respects limit", async () => {
      const result = await client.callTool({
        name: "list_sessions",
        arguments: { limit: 1 },
      });
      const content = result.content as { type: string; text: string }[];
      const data = JSON.parse(content[0].text);
      expect(data.length).toBeLessThanOrEqual(1);
    });

    it("filters latest_only", async () => {
      const result = await client.callTool({
        name: "list_sessions",
        arguments: { latest_only: true },
      });
      const content = result.content as { type: string; text: string }[];
      const data = JSON.parse(content[0].text);
      // Each project should appear at most once
      const projects = data.map(
        (s: { project_path: string }) => s.project_path,
      );
      expect(projects.length).toBe(new Set(projects).size);
    });

    it("returns error for invalid since format", async () => {
      const result = await client.callTool({
        name: "list_sessions",
        arguments: { since: "invalid" },
      });
      expect(result.isError).toBe(true);
      const content = result.content as { type: string; text: string }[];
      expect(content[0].text).toContain("Invalid duration");
    });
  });

  describe("inspect_session", () => {
    it("returns session by prefix", async () => {
      const result = await client.callTool({
        name: "inspect_session",
        arguments: { session_id: "aaaaaaaa-bbbb" },
      });
      expect(result.isError).toBeFalsy();
      const content = result.content as { type: string; text: string }[];
      const data = JSON.parse(content[0].text);
      expect(data.id).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
      expect(data).toHaveProperty("sub_agents");
    });

    it("returns error for nonexistent session", async () => {
      const result = await client.callTool({
        name: "inspect_session",
        arguments: { session_id: "zzzzzzzz-not-found" },
      });
      expect(result.isError).toBe(true);
      const content = result.content as { type: string; text: string }[];
      expect(content[0].text).toContain("No session found");
    });

    it("returns full UUID match", async () => {
      const result = await client.callTool({
        name: "inspect_session",
        arguments: {
          session_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        },
      });
      expect(result.isError).toBeFalsy();
      const content = result.content as { type: string; text: string }[];
      const data = JSON.parse(content[0].text);
      expect(data.id).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    });
  });

  describe("get_status", () => {
    it("returns aggregate summary", async () => {
      const result = await client.callTool({
        name: "get_status",
        arguments: {},
      });
      expect(result.isError).toBeFalsy();
      const content = result.content as { type: string; text: string }[];
      const data = JSON.parse(content[0].text);
      expect(data).toHaveProperty("project_count");
      expect(data).toHaveProperty("total_sessions");
      expect(data).toHaveProperty("active_sessions");
      expect(data).toHaveProperty("last_24h_sessions");
      expect(data).toHaveProperty("active_session_list");
      expect(data.project_count).toBeGreaterThan(0);
    });
  });

  describe("find_session", () => {
    it("finds sessions matching branch name", async () => {
      const result = await client.callTool({
        name: "find_session",
        arguments: { query: "main" },
      });
      expect(result.isError).toBeFalsy();
      const content = result.content as { type: string; text: string }[];
      const data = JSON.parse(content[0].text);
      expect(Array.isArray(data)).toBe(true);
      // Our fixture sessions have branch "main"
      expect(data.length).toBeGreaterThan(0);
    });

    it("returns empty array for no matches", async () => {
      const result = await client.callTool({
        name: "find_session",
        arguments: { query: "xyzzy_nonexistent_query_12345" },
      });
      expect(result.isError).toBeFalsy();
      const content = result.content as { type: string; text: string }[];
      const data = JSON.parse(content[0].text);
      expect(data).toEqual([]);
    });

    it("respects limit parameter", async () => {
      const result = await client.callTool({
        name: "find_session",
        arguments: { query: "main", limit: 1 },
      });
      const content = result.content as { type: string; text: string }[];
      const data = JSON.parse(content[0].text);
      expect(data.length).toBeLessThanOrEqual(1);
    });

    it("searches summaries", async () => {
      // "Test session" is the summary in our fixture
      const result = await client.callTool({
        name: "find_session",
        arguments: { query: "Test session" },
      });
      const content = result.content as { type: string; text: string }[];
      const data = JSON.parse(content[0].text);
      expect(data.length).toBeGreaterThan(0);
    });
  });
});
