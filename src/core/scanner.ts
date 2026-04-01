import { readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ScannerOptions } from "../types.js";

/**
 * Returns the absolute path to the Claude projects directory.
 */
export function getProjectsDir(options?: ScannerOptions): string {
  const claudeDir = options?.claudeDir ?? path.join(os.homedir(), ".claude");
  return path.join(claudeDir, "projects");
}

/**
 * Scans the projects directory and returns sorted encoded directory names.
 * Returns an empty array if the directory does not exist.
 */
export async function scanProjectDirs(
  options?: ScannerOptions,
): Promise<string[]> {
  const projectsDir = getProjectsDir(options);

  let entries: Dirent[];
  try {
    entries = await readdir(projectsDir, { withFileTypes: true });
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return [];
    }
    throw err;
  }

  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  dirs.sort();
  return dirs;
}
