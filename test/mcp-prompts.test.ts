import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server.js";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, "fixtures");
const MOCK_CLAUDE = path.join(FIXTURES, "mock-claude-dir");

describe("MCP Prompts", () => {
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

  describe("listPrompts", () => {
    it("returns three prompt templates", async () => {
      const result = await client.listPrompts();
      expect(result.prompts).toHaveLength(3);
      const names = result.prompts.map((p) => p.name);
      expect(names).toContain("session_overview");
      expect(names).toContain("project_history");
      expect(names).toContain("find_work");
    });

    it("each prompt has a description", async () => {
      const result = await client.listPrompts();
      for (const prompt of result.prompts) {
        expect(prompt.description).toBeTruthy();
      }
    });

    it("project_history has a project_path argument", async () => {
      const result = await client.listPrompts();
      const ph = result.prompts.find((p) => p.name === "project_history");
      expect(ph).toBeDefined();
      expect(ph!.arguments).toBeDefined();
      const args = ph!.arguments!;
      const projectPathArg = args.find(
        (a: { name: string }) => a.name === "project_path",
      );
      expect(projectPathArg).toBeDefined();
      expect(projectPathArg!.required).toBe(true);
    });

    it("find_work has a description argument", async () => {
      const result = await client.listPrompts();
      const fw = result.prompts.find((p) => p.name === "find_work");
      expect(fw).toBeDefined();
      const args = fw!.arguments!;
      const descArg = args.find(
        (a: { name: string }) => a.name === "description",
      );
      expect(descArg).toBeDefined();
    });
  });

  describe("getPrompt: session_overview", () => {
    it("returns a well-formed prompt message", async () => {
      const result = await client.getPrompt({
        name: "session_overview",
      });
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe("user");
      const content = result.messages[0].content;
      expect(content.type).toBe("text");
      expect((content as { text: string }).text).toContain("get_status");
    });
  });

  describe("getPrompt: project_history", () => {
    it("returns a prompt referencing the given project path", async () => {
      const result = await client.getPrompt({
        name: "project_history",
        arguments: { project_path: "/Users/alice/projects/my-app" },
      });
      expect(result.messages).toHaveLength(1);
      const text = (result.messages[0].content as { text: string }).text;
      expect(text).toContain("list_sessions");
      expect(text).toContain("/Users/alice/projects/my-app");
    });
  });

  describe("getPrompt: find_work", () => {
    it("returns a prompt referencing the given description", async () => {
      const result = await client.getPrompt({
        name: "find_work",
        arguments: { description: "FHIR transformer" },
      });
      expect(result.messages).toHaveLength(1);
      const text = (result.messages[0].content as { text: string }).text;
      expect(text).toContain("find_session");
      expect(text).toContain("FHIR transformer");
    });
  });
});
