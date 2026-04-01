import { createReadStream } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as readline from "node:readline";
import type {
  HistoryEntry,
  HistorySessionData,
  ScannerOptions,
} from "../types.js";

/**
 * Stream-parse history.jsonl and return data grouped by session.
 */
export async function parseHistoryBySession(
  options?: ScannerOptions,
): Promise<Map<string, HistorySessionData>> {
  const claudeDir = options?.claudeDir ?? path.join(os.homedir(), ".claude");
  const historyPath = path.join(claudeDir, "history.jsonl");
  const map = new Map<string, HistorySessionData>();

  let stream: ReturnType<typeof createReadStream>;
  try {
    stream = createReadStream(historyPath, { encoding: "utf-8" });
  } catch {
    return map;
  }

  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as Partial<HistoryEntry>;
        if (!entry.sessionId || !entry.project || entry.timestamp == null)
          continue;

        const existing = map.get(entry.sessionId);
        if (existing) {
          if (entry.timestamp < existing.firstTimestamp) {
            existing.firstTimestamp = entry.timestamp;
          }
          if (entry.timestamp > existing.lastTimestamp) {
            existing.lastTimestamp = entry.timestamp;
          }
          existing.promptCount++;
        } else {
          map.set(entry.sessionId, {
            sessionId: entry.sessionId,
            project: entry.project,
            firstTimestamp: entry.timestamp,
            lastTimestamp: entry.timestamp,
            promptCount: 1,
          });
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return map;
    }
    throw err;
  }

  return map;
}

/**
 * Stream-parse history.jsonl and invoke a callback for each entry.
 * Return false from the callback to stop early.
 * Returns the number of entries processed.
 */
export async function streamHistory(
  callback: (entry: HistoryEntry) => boolean | void,
  options?: ScannerOptions,
): Promise<number> {
  const claudeDir = options?.claudeDir ?? path.join(os.homedir(), ".claude");
  const historyPath = path.join(claudeDir, "history.jsonl");
  let count = 0;

  let stream: ReturnType<typeof createReadStream>;
  try {
    stream = createReadStream(historyPath, { encoding: "utf-8" });
  } catch {
    return 0;
  }

  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as HistoryEntry;
        count++;
        const result = callback(entry);
        if (result === false) {
          rl.close();
          stream.destroy();
          break;
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return 0;
    }
    throw err;
  }

  return count;
}
