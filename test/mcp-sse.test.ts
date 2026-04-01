import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "../src/mcp/server.js";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, "fixtures");
const MOCK_CLAUDE = path.join(FIXTURES, "mock-claude-dir");

const MCP_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

describe("MCP SSE Transport", () => {
  let killSpy: ReturnType<typeof vi.spyOn>;
  let httpServer: ReturnType<typeof createServer>;
  let port: number;
  const transports = new Map<string, StreamableHTTPServerTransport>();

  beforeAll(async () => {
    killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      const err = new Error("ESRCH") as NodeJS.ErrnoException;
      err.code = "ESRCH";
      throw err;
    });

    httpServer = createServer(async (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, DELETE, OPTIONS",
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, mcp-session-id, Accept",
      );
      res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.url !== "/mcp") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (sessionId && transports.has(sessionId)) {
        const transport = transports.get(sessionId)!;
        await transport.handleRequest(req, res);
        return;
      }

      if (req.method === "POST" && !sessionId) {
        const server = createMcpServer({ claudeDir: MOCK_CLAUDE });
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (id) => {
            transports.set(id, transport);
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) {
            transports.delete(transport.sessionId);
          }
        };
        await server.connect(transport);
        await transport.handleRequest(req, res);
        return;
      }

      res.writeHead(400);
      res.end("Bad request");
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const addr = httpServer.address();
        port = typeof addr === "object" && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  afterAll(async () => {
    for (const transport of transports.values()) {
      await transport.close();
    }
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
    killSpy.mockRestore();
  });

  it("accepts an HTTP POST to /mcp and returns a valid MCP response", async () => {
    const response = await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers: MCP_HEADERS,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test-http-client", version: "1.0.0" },
        },
      }),
    });

    expect(response.ok).toBe(true);

    const sessionId = response.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();

    const body = await response.json();
    expect(body.result).toBeDefined();
    expect(body.result.serverInfo).toBeDefined();
    expect(body.result.serverInfo.name).toBe("claude-agents");
  });

  it("returns 404 for non-/mcp paths", async () => {
    const response = await fetch(`http://localhost:${port}/other`, {
      method: "POST",
    });
    expect(response.status).toBe(404);
  });

  it("can call a tool via HTTP after initialization", async () => {
    // Initialize
    const initResponse = await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers: MCP_HEADERS,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test-http-client", version: "1.0.0" },
        },
      }),
    });

    const sessionId = initResponse.headers.get("mcp-session-id")!;
    await initResponse.json();

    // Send initialized notification
    await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers: {
        ...MCP_HEADERS,
        "mcp-session-id": sessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });

    // Call get_status tool
    const toolResponse = await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers: {
        ...MCP_HEADERS,
        "mcp-session-id": sessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "get_status",
          arguments: {},
        },
      }),
    });

    expect(toolResponse.ok).toBe(true);
    const toolBody = await toolResponse.json();
    expect(toolBody.result).toBeDefined();
    expect(toolBody.result.content).toBeDefined();

    const data = JSON.parse(toolBody.result.content[0].text);
    expect(data).toHaveProperty("project_count");
    expect(data).toHaveProperty("total_sessions");
  });
});
