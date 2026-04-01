import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import type { ScannerOptions } from "../types.js";
import { registerTools } from "./tools.js";
import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts.js";

/**
 * Create and configure an MCP server with tools, resources, and prompts.
 */
export function createMcpServer(scannerOptions: ScannerOptions): McpServer {
  const server = new McpServer({
    name: "claude-agents",
    version: "0.1.0",
  });

  registerTools(server, scannerOptions);
  registerResources(server, scannerOptions);
  registerPrompts(server);

  return server;
}

/**
 * Start the MCP server on stdio transport.
 */
export async function startStdioServer(
  scannerOptions: ScannerOptions,
): Promise<void> {
  const server = createMcpServer(scannerOptions);
  const transport = new StdioServerTransport();

  const cleanup = async () => {
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  await server.connect(transport);
}

/**
 * Start the MCP server on HTTP+SSE transport.
 */
export async function startSseServer(
  scannerOptions: ScannerOptions,
  port: number,
): Promise<void> {
  // Track transports by session ID for cleanup
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createServer(async (req, res) => {
    // Handle CORS for cross-origin MCP clients
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id");
    res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Only handle /mcp endpoint
    if (req.url !== "/mcp") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    // Check for existing session
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && transports.has(sessionId)) {
      // Existing session — route to its transport
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res);
      return;
    }

    if (req.method === "POST" && !sessionId) {
      // New session — create server + transport
      const server = createMcpServer(scannerOptions);
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

  const cleanup = () => {
    httpServer.close();
    for (const transport of transports.values()) {
      transport.close();
    }
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  httpServer.listen(port, () => {
    process.stderr.write(
      `MCP server listening on http://localhost:${port}/mcp\n`,
    );
  });
}
