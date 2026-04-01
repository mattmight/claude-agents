import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server.js";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, "fixtures");
const MOCK_CLAUDE = path.join(FIXTURES, "mock-claude-dir");

describe("MCP Resources", () => {
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

  describe("listResources", () => {
    it("returns resource URIs including static and template resources", async () => {
      const result = await client.listResources();
      expect(result.resources.length).toBeGreaterThan(0);
      const uris = result.resources.map((r) => r.uri);
      // Static resources
      expect(uris).toContain("claude-agents://projects");
      expect(uris).toContain("claude-agents://status");
    });

    it("each resource has a name and URI", async () => {
      const result = await client.listResources();
      for (const resource of result.resources) {
        expect(resource.uri).toBeTruthy();
        expect(resource.name).toBeTruthy();
      }
    });
  });

  describe("listResourceTemplates", () => {
    it("returns template patterns for projects and sessions", async () => {
      const result = await client.listResourceTemplates();
      const templates = result.resourceTemplates.map((t) => t.uriTemplate);
      expect(templates).toContain(
        "claude-agents://projects/{encoded_dir}",
      );
      expect(templates).toContain(
        "claude-agents://sessions/{session_id}",
      );
    });
  });

  describe("readResource: projects", () => {
    it("returns project list as JSON", async () => {
      const result = await client.readResource({
        uri: "claude-agents://projects",
      });
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].mimeType).toBe("application/json");
      const data = JSON.parse(result.contents[0].text as string);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty("path");
      expect(data[0]).toHaveProperty("session_count");
    });
  });

  describe("readResource: status", () => {
    it("returns status summary as JSON", async () => {
      const result = await client.readResource({
        uri: "claude-agents://status",
      });
      expect(result.contents).toHaveLength(1);
      const data = JSON.parse(result.contents[0].text as string);
      expect(data).toHaveProperty("project_count");
      expect(data).toHaveProperty("total_sessions");
      expect(data).toHaveProperty("active_sessions");
    });
  });

  describe("readResource: single project", () => {
    it("returns project with sessions by encoded dir", async () => {
      const result = await client.readResource({
        uri: "claude-agents://projects/-Users-alice-projects-my-app",
      });
      expect(result.contents).toHaveLength(1);
      const data = JSON.parse(result.contents[0].text as string);
      expect(data).toHaveProperty("path");
      expect(data).toHaveProperty("sessions");
      expect(Array.isArray(data.sessions)).toBe(true);
      expect(data.sessions.length).toBeGreaterThan(0);
    });
  });

  describe("readResource: single session", () => {
    it("returns session detail by full ID", async () => {
      const result = await client.readResource({
        uri: "claude-agents://sessions/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      });
      expect(result.contents).toHaveLength(1);
      const data = JSON.parse(result.contents[0].text as string);
      expect(data.id).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
      expect(data).toHaveProperty("sub_agents");
    });

    it("resolves session by prefix", async () => {
      const result = await client.readResource({
        uri: "claude-agents://sessions/bbbbbbbb",
      });
      expect(result.contents).toHaveLength(1);
      const data = JSON.parse(result.contents[0].text as string);
      expect(data.id).toBe("bbbbbbbb-1111-2222-3333-444444444444");
    });
  });
});
