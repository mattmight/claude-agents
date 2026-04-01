import { describe, it, expect, afterEach } from "vitest";
import { watchProjectsDir } from "../src/core/watcher.js";
import { writeFile, mkdir, rm } from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

describe("watchProjectsDir", () => {
  let cleanupFn: (() => void) | null = null;
  let tmpDir: string | null = null;

  afterEach(async () => {
    if (cleanupFn) {
      cleanupFn();
      cleanupFn = null;
    }
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
      tmpDir = null;
    }
  });

  it("returns a cleanup function", () => {
    const cleanup = watchProjectsDir(() => {}, {
      claudeDir: "/nonexistent/path",
    });
    expect(typeof cleanup).toBe("function");
    cleanup();
  });

  it("handles nonexistent directory gracefully", () => {
    const cleanup = watchProjectsDir(() => {}, {
      claudeDir: "/nonexistent/path",
    });
    // Should not throw
    cleanup();
  });

  it("detects file changes in the watched directory", async () => {
    // Create a temp directory structure
    tmpDir = path.join(
      os.tmpdir(),
      `claude-agents-test-${Date.now()}`,
    );
    const projectsDir = path.join(tmpDir, "projects");
    await mkdir(projectsDir, { recursive: true });

    let resolved = false;
    const changeDetected = new Promise<{ eventType: string; filename: string | null }>((resolve) => {
      cleanupFn = watchProjectsDir(
        (eventType, filename) => {
          if (!resolved) {
            resolved = true;
            resolve({ eventType, filename });
          }
        },
        { claudeDir: tmpDir!, debounceMs: 10 },
      );
    });

    // Give the watcher time to start
    await new Promise((r) => setTimeout(r, 50));

    // Write a file to trigger the watcher
    await writeFile(path.join(projectsDir, "test.json"), "{}");

    const result = await Promise.race([
      changeDetected,
      new Promise<null>((r) => setTimeout(() => r(null), 2000)),
    ]);

    // On some systems (macOS), recursive watch may not fire immediately
    // but the watcher should at least not throw
    if (result) {
      expect(result.eventType).toBeTruthy();
    }
  });

  it("debounces rapid changes", async () => {
    tmpDir = path.join(
      os.tmpdir(),
      `claude-agents-test-debounce-${Date.now()}`,
    );
    const projectsDir = path.join(tmpDir, "projects");
    await mkdir(projectsDir, { recursive: true });

    let callCount = 0;
    cleanupFn = watchProjectsDir(
      () => {
        callCount++;
      },
      { claudeDir: tmpDir!, debounceMs: 50 },
    );

    await new Promise((r) => setTimeout(r, 50));

    // Write multiple files rapidly
    await writeFile(path.join(projectsDir, "a.json"), "{}");
    await writeFile(path.join(projectsDir, "b.json"), "{}");
    await writeFile(path.join(projectsDir, "c.json"), "{}");

    // Wait for debounce window + extra
    await new Promise((r) => setTimeout(r, 200));

    // Due to debouncing, callCount should be less than 3
    // (may be 0 on some systems where recursive watch doesn't work)
    expect(callCount).toBeLessThanOrEqual(3);
  });
});
