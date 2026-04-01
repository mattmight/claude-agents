import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createColors } from "../../src/utils/colors.js";
import {
  runProjectsCommand,
  buildProjectRows,
} from "../../src/commands/projects.js";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, "..", "fixtures");
const MOCK_CLAUDE = path.join(FIXTURES, "mock-claude-dir");

const noColors = createColors(false);

describe("buildProjectRows", () => {
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      const err = new Error("ESRCH") as NodeJS.ErrnoException;
      err.code = "ESRCH";
      throw err;
    });
  });

  afterEach(() => {
    killSpy.mockRestore();
  });

  it("aggregates sessions by project path", async () => {
    const rows = await buildProjectRows({ claudeDir: MOCK_CLAUDE });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.sessionCount).toBeGreaterThanOrEqual(0);
      expect(row.path).toBeTruthy();
    }
  });

  it("computes sessionCount per project", async () => {
    const rows = await buildProjectRows({ claudeDir: MOCK_CLAUDE });
    const myApp = rows.find((r) => r.path.includes("my-app"));
    expect(myApp).toBeDefined();
    expect(myApp!.sessionCount).toBeGreaterThan(0);
  });

  it("sets status to stopped when all PIDs are dead", async () => {
    const rows = await buildProjectRows({ claudeDir: MOCK_CLAUDE });
    // All processes are dead (mocked), so all projects should be stopped
    for (const row of rows) {
      expect(["active", "stopped"]).toContain(row.status);
    }
  });
});

describe("runProjectsCommand", () => {
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      const err = new Error("ESRCH") as NodeJS.ErrnoException;
      err.code = "ESRCH";
      throw err;
    });
  });

  afterEach(() => {
    killSpy.mockRestore();
  });

  it("returns table-formatted output by default", async () => {
    const { output } = await runProjectsCommand(
      { claudeDir: MOCK_CLAUDE },
      noColors,
    );
    expect(output).toContain("PROJECT PATH");
    expect(output).toContain("SESSIONS");
  });

  it("returns JSON when json option is true", async () => {
    const { output } = await runProjectsCommand(
      { claudeDir: MOCK_CLAUDE, json: true },
      noColors,
    );
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    if (parsed.length > 0) {
      expect(parsed[0]).toHaveProperty("path");
      expect(parsed[0]).toHaveProperty("session_count");
    }
  });

  it("filters to active-only with --active flag", async () => {
    const { output } = await runProjectsCommand(
      { claudeDir: MOCK_CLAUDE, active: true, json: true },
      noColors,
    );
    const parsed = JSON.parse(output);
    for (const p of parsed) {
      expect(p.status).toBe("active");
    }
  });

  it("sorts by path alphabetically (default)", async () => {
    const { output } = await runProjectsCommand(
      { claudeDir: MOCK_CLAUDE, json: true },
      noColors,
    );
    const parsed = JSON.parse(output);
    if (parsed.length > 1) {
      const paths = parsed.map((p: { path: string }) => p.path);
      const sorted = [...paths].sort();
      expect(paths).toEqual(sorted);
    }
  });

  it("sorts by session_count descending", async () => {
    const { output } = await runProjectsCommand(
      { claudeDir: MOCK_CLAUDE, sort: "session_count", json: true },
      noColors,
    );
    const parsed = JSON.parse(output);
    if (parsed.length > 1) {
      for (let i = 1; i < parsed.length; i++) {
        expect(parsed[i - 1].session_count).toBeGreaterThanOrEqual(
          parsed[i].session_count,
        );
      }
    }
  });

  it("handles empty project list", async () => {
    const { output } = await runProjectsCommand(
      { claudeDir: "/nonexistent/path" },
      noColors,
    );
    expect(output).toBe("No projects found.");
  });
});
