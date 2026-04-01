import { watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ScannerOptions } from "../types.js";

export type WatcherCallback = (eventType: string, filename: string | null) => void;

export interface WatcherOptions extends ScannerOptions {
  /** Debounce window in milliseconds (default: 100) */
  debounceMs?: number;
}

/**
 * Watch the ~/.claude/projects/ directory for changes.
 * Debounces rapid changes within the given window.
 * Returns a cleanup function that stops watching.
 */
export function watchProjectsDir(
  callback: WatcherCallback,
  options?: WatcherOptions,
): () => void {
  const base = options?.claudeDir ?? path.join(os.homedir(), ".claude");
  const projectsDir = path.join(base, "projects");
  const debounceMs = options?.debounceMs ?? 100;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingEvent: { eventType: string; filename: string | null } | null =
    null;
  let watcher: FSWatcher | null = null;

  try {
    watcher = watch(projectsDir, { recursive: true }, (eventType, filename) => {
      pendingEvent = { eventType, filename: filename ?? null };
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (pendingEvent) {
          callback(pendingEvent.eventType, pendingEvent.filename);
          pendingEvent = null;
        }
      }, debounceMs);
    });
  } catch {
    // Directory doesn't exist or can't be watched — return no-op cleanup
    return () => {};
  }

  return () => {
    if (timer) clearTimeout(timer);
    if (watcher) watcher.close();
  };
}
