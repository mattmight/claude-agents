import { describe, it, expect } from "vitest";
import {
  resolveProjectPath,
  resolveAllProjects,
  encodePath,
  buildHistoryPathMap,
} from "../src/core/path-resolver.js";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, "fixtures");
const MOCK_CLAUDE = path.join(FIXTURES, "mock-claude-dir");

describe("encodePath", () => {
  it("encodes a simple Unix path", () => {
    expect(encodePath("/Users/alice/projects/my-app")).toBe(
      "-Users-alice-projects-my-app",
    );
  });

  it("encodes spaces as hyphens", () => {
    expect(encodePath("/Volumes/My Shared Files/project")).toBe(
      "-Volumes-My-Shared-Files-project",
    );
  });

  it("encodes dots as hyphens", () => {
    expect(encodePath("/Users/alice/projects/my.dotted.project")).toBe(
      "-Users-alice-projects-my-dotted-project",
    );
  });

  it("preserves existing hyphens", () => {
    expect(encodePath("/Users/alice/VIP-Patient-Dutch")).toBe(
      "-Users-alice-VIP-Patient-Dutch",
    );
  });

  it("handles mixed special characters", () => {
    expect(encodePath("/tmp/a b.c/d")).toBe("-tmp-a-b-c-d");
  });
});

describe("resolveProjectPath", () => {
  it("resolves via sessions-index.json when available", async () => {
    const result = await resolveProjectPath("-Users-alice-projects-my-app", {
      claudeDir: MOCK_CLAUDE,
    });
    expect(result.realPath).toBe("/Users/alice/projects/my-app");
    expect(result.resolvedVia).toBe("sessions-index");
    expect(result.warning).toBe(false);
  });

  it("resolves a dotted path via sessions-index.json", async () => {
    const result = await resolveProjectPath(
      "-Users-alice-projects-my-dotted-project",
      { claudeDir: MOCK_CLAUDE },
    );
    expect(result.realPath).toBe("/Users/alice/projects/my.dotted.project");
    expect(result.resolvedVia).toBe("sessions-index");
    expect(result.warning).toBe(false);
  });

  it("falls back to history.jsonl when sessions-index.json is missing", async () => {
    const result = await resolveProjectPath(
      "-Users-alice-code-orphan-project",
      { claudeDir: MOCK_CLAUDE },
    );
    expect(result.realPath).toBe("/Users/alice/code/orphan-project");
    expect(result.resolvedVia).toBe("history");
    expect(result.warning).toBe(false);
  });

  it("returns null with warning when path cannot be resolved", async () => {
    const result = await resolveProjectPath("-Users-alice-unknown-thing", {
      claudeDir: MOCK_CLAUDE,
    });
    expect(result.realPath).toBeNull();
    expect(result.resolvedVia).toBeNull();
    expect(result.warning).toBe(true);
  });

  it("populates encodedDir and dirPath correctly", async () => {
    const result = await resolveProjectPath("-Users-alice-projects-my-app", {
      claudeDir: MOCK_CLAUDE,
    });
    expect(result.encodedDir).toBe("-Users-alice-projects-my-app");
    expect(result.dirPath).toBe(
      path.join(MOCK_CLAUDE, "projects", "-Users-alice-projects-my-app"),
    );
  });
});

describe("resolveAllProjects", () => {
  it("resolves all project paths in batch", async () => {
    const dirs = [
      "-Users-alice-projects-my-app",
      "-Users-alice-code-orphan-project",
      "-Users-alice-unknown-thing",
    ];
    const results = await resolveAllProjects(dirs, { claudeDir: MOCK_CLAUDE });

    expect(results).toHaveLength(3);

    const byDir = new Map(results.map((r) => [r.encodedDir, r]));

    const app = byDir.get("-Users-alice-projects-my-app")!;
    expect(app.realPath).toBe("/Users/alice/projects/my-app");
    expect(app.resolvedVia).toBe("sessions-index");

    const orphan = byDir.get("-Users-alice-code-orphan-project")!;
    expect(orphan.realPath).toBe("/Users/alice/code/orphan-project");
    expect(orphan.resolvedVia).toBe("history");

    const unknown = byDir.get("-Users-alice-unknown-thing")!;
    expect(unknown.realPath).toBeNull();
    expect(unknown.warning).toBe(true);
  });

  it("handles empty input", async () => {
    const results = await resolveAllProjects([], { claudeDir: MOCK_CLAUDE });
    expect(results).toEqual([]);
  });
});

describe("buildHistoryPathMap", () => {
  it("builds a map from encoded dir names to real paths", async () => {
    const map = await buildHistoryPathMap({ claudeDir: MOCK_CLAUDE });
    expect(map.get("-Users-alice-code-orphan-project")).toBe(
      "/Users/alice/code/orphan-project",
    );
  });

  it("returns empty map when history.jsonl does not exist", async () => {
    const map = await buildHistoryPathMap({
      claudeDir: path.join(FIXTURES, "empty-claude-dir"),
    });
    expect(map.size).toBe(0);
  });
});
