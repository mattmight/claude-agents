import type { ScannerOptions } from "../types.js";
import { startStdioServer, startSseServer } from "../mcp/server.js";

export interface ServeCommandOptions {
  claudeDir?: string;
  sse?: boolean;
  port?: number;
}

export async function runServeCommand(
  options: ServeCommandOptions,
): Promise<void> {
  const scannerOptions: ScannerOptions = {};
  if (options.claudeDir) scannerOptions.claudeDir = options.claudeDir;

  if (options.sse) {
    const port = options.port ?? 3100;
    await startSseServer(scannerOptions, port);
  } else {
    await startStdioServer(scannerOptions);
  }
}
