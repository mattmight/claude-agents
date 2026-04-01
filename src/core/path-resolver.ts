import * as fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as readline from "node:readline";
import type {
  ProjectEntry,
  ScannerOptions,
  SessionsIndex,
} from "../types.js";

/**
 * Encode a real filesystem path using Claude Code's encoding scheme.
 * Replaces all non-alphanumeric characters with hyphens.
 */
export function encodePath(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, "-");
}

/**
 * Resolve a single encoded directory to its real filesystem path.
 *
 * Strategy:
 * 1. Try sessions-index.json → use originalPath
 * 2. Fallback: scan history.jsonl
 * 3. If neither works: { realPath: null, warning: true }
 */
export async function resolveProjectPath(
  encodedDir: string,
  options?: ScannerOptions,
): Promise<ProjectEntry> {
  const claudeDir = options?.claudeDir ?? path.join(os.homedir(), ".claude");
  const dirPath = path.join(claudeDir, "projects", encodedDir);

  // Try sessions-index.json
  const indexResult = await trySessionsIndex(dirPath);
  if (indexResult !== null) {
    return {
      encodedDir,
      dirPath,
      realPath: indexResult,
      resolvedVia: "sessions-index",
      warning: false,
    };
  }

  // Fallback: history.jsonl
  const historyMap = await buildHistoryPathMap(options);
  const historyResult = historyMap.get(encodedDir);
  if (historyResult !== undefined) {
    return {
      encodedDir,
      dirPath,
      realPath: historyResult,
      resolvedVia: "history",
      warning: false,
    };
  }

  // Unresolvable
  return {
    encodedDir,
    dirPath,
    realPath: null,
    resolvedVia: null,
    warning: true,
  };
}

/**
 * Resolve all encoded directories in batch.
 * Parses history.jsonl at most once for efficiency.
 */
export async function resolveAllProjects(
  encodedDirs: string[],
  options?: ScannerOptions,
): Promise<ProjectEntry[]> {
  if (encodedDirs.length === 0) return [];

  const claudeDir = options?.claudeDir ?? path.join(os.homedir(), ".claude");
  const results: ProjectEntry[] = [];
  const unresolved: string[] = [];

  // First pass: try sessions-index.json for each
  await Promise.all(
    encodedDirs.map(async (encodedDir) => {
      const dirPath = path.join(claudeDir, "projects", encodedDir);
      const indexResult = await trySessionsIndex(dirPath);

      if (indexResult !== null) {
        results.push({
          encodedDir,
          dirPath,
          realPath: indexResult,
          resolvedVia: "sessions-index",
          warning: false,
        });
      } else {
        unresolved.push(encodedDir);
      }
    }),
  );

  // Second pass: history.jsonl fallback for unresolved
  if (unresolved.length > 0) {
    const historyMap = await buildHistoryPathMap(options);

    for (const encodedDir of unresolved) {
      const dirPath = path.join(claudeDir, "projects", encodedDir);
      const historyResult = historyMap.get(encodedDir);

      if (historyResult !== undefined) {
        results.push({
          encodedDir,
          dirPath,
          realPath: historyResult,
          resolvedVia: "history",
          warning: false,
        });
      } else {
        results.push({
          encodedDir,
          dirPath,
          realPath: null,
          resolvedVia: null,
          warning: true,
        });
      }
    }
  }

  return results;
}

/**
 * Build a mapping from encoded directory names to real paths by scanning history.jsonl.
 */
export async function buildHistoryPathMap(
  options?: ScannerOptions,
): Promise<Map<string, string>> {
  const claudeDir = options?.claudeDir ?? path.join(os.homedir(), ".claude");
  const historyPath = path.join(claudeDir, "history.jsonl");
  const map = new Map<string, string>();

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
        const entry = JSON.parse(line) as { project?: string };
        if (entry.project) {
          const encoded = encodePath(entry.project);
          map.set(encoded, entry.project);
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
 * Try to extract the real path from sessions-index.json in the given directory.
 * Returns null if the file doesn't exist, is malformed, or lacks path info.
 */
async function trySessionsIndex(dirPath: string): Promise<string | null> {
  const indexPath = path.join(dirPath, "sessions-index.json");

  let raw: string;
  try {
    raw = await fs.readFile(indexPath, "utf-8");
  } catch {
    return null;
  }

  try {
    const index = JSON.parse(raw) as Partial<SessionsIndex>;

    // Primary: top-level originalPath
    if (index.originalPath) {
      return index.originalPath;
    }

    // Fallback: first entry's projectPath
    if (index.entries && index.entries.length > 0 && index.entries[0].projectPath) {
      return index.entries[0].projectPath;
    }
  } catch {
    // Malformed JSON — fall through
  }

  return null;
}
