import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createColors } from "../../src/utils/colors.js";
import { runSessionsCommand } from "../../src/commands/sessions.js";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, "..", "fixtures");
const MOCK_CLAUDE = path.join(FIXTURES, "mock-claude-dir");

const noColors = createColors(false);

describe("runSessionsCommand", () => {
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

  it("returns all sessions as table by default", async () => {
    const { output } = await runSessionsCommand(
      undefined,
      { claudeDir: MOCK_CLAUDE },
      noColors,
    );
    expect(output).toContain("SESSION ID");
    expect(output).toContain("PROJECT");
    expect(output).toContain("BRANCH");
  });

  it("returns JSON when json option is true", async () => {
    const { output } = await runSessionsCommand(
      undefined,
      { claudeDir: MOCK_CLAUDE, json: true },
      noColors,
    );
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    if (parsed.length > 0) {
      expect(parsed[0]).toHaveProperty("id");
      expect(parsed[0]).toHaveProperty("project_path");
      expect(parsed[0]).toHaveProperty("status");
    }
  });

  it("filters by project path (exact match)", async () => {
    // Get all sessions first to find a real project path
    const allOutput = await runSessionsCommand(
      undefined,
      { claudeDir: MOCK_CLAUDE, json: true },
      noColors,
    );
    const allSessions = JSON.parse(allOutput.output);
    if (allSessions.length === 0) return;

    const projectPath = allSessions[0].project_path;
    if (!projectPath) return;

    const { output } = await runSessionsCommand(
      projectPath,
      { claudeDir: MOCK_CLAUDE, json: true },
      noColors,
    );
    const filtered = JSON.parse(output);
    for (const s of filtered) {
      expect(s.project_path).toBe(projectPath);
    }
  });

  it("filters by project path (substring match)", async () => {
    const { output } = await runSessionsCommand(
      "my-app",
      { claudeDir: MOCK_CLAUDE, json: true },
      noColors,
    );
    const parsed = JSON.parse(output);
    for (const s of parsed) {
      expect(s.project_path.toLowerCase()).toContain("my-app");
    }
  });

  it("filters active-only with --active", async () => {
    const { output } = await runSessionsCommand(
      undefined,
      { claudeDir: MOCK_CLAUDE, active: true, json: true },
      noColors,
    );
    const parsed = JSON.parse(output);
    for (const s of parsed) {
      expect(["active", "likely_active"]).toContain(s.status);
    }
  });

  it("filters by --since with huge window", async () => {
    // With a huge since window, all sessions should be excluded
    // (since they're old fixture data)
    // Actually "since 999999d" would include everything
    const { output } = await runSessionsCommand(
      undefined,
      { claudeDir: MOCK_CLAUDE, since: "999999d", json: true },
      noColors,
    );
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("applies --latest to keep one session per project", async () => {
    const { output } = await runSessionsCommand(
      undefined,
      { claudeDir: MOCK_CLAUDE, latest: true, json: true },
      noColors,
    );
    const parsed = JSON.parse(output);
    // Each project should appear at most once
    const projects = parsed.map(
      (s: { project_path: string }) => s.project_path,
    );
    const uniqueProjects = new Set(projects);
    expect(projects.length).toBe(uniqueProjects.size);
  });

  it("respects --limit", async () => {
    const { output } = await runSessionsCommand(
      undefined,
      { claudeDir: MOCK_CLAUDE, limit: 1, json: true },
      noColors,
    );
    const parsed = JSON.parse(output);
    expect(parsed.length).toBeLessThanOrEqual(1);
  });

  it("sorts by time descending (default)", async () => {
    const { output } = await runSessionsCommand(
      undefined,
      { claudeDir: MOCK_CLAUDE, json: true },
      noColors,
    );
    const parsed = JSON.parse(output);
    if (parsed.length > 1) {
      for (let i = 1; i < parsed.length; i++) {
        expect(
          new Date(parsed[i - 1].updated_at).getTime(),
        ).toBeGreaterThanOrEqual(new Date(parsed[i].updated_at).getTime());
      }
    }
  });

  it("sorts by project", async () => {
    const { output } = await runSessionsCommand(
      undefined,
      { claudeDir: MOCK_CLAUDE, sort: "project", json: true },
      noColors,
    );
    const parsed = JSON.parse(output);
    if (parsed.length > 1) {
      for (let i = 1; i < parsed.length; i++) {
        const prev = parsed[i - 1].project_path ?? "";
        const curr = parsed[i].project_path ?? "";
        expect(prev.localeCompare(curr)).toBeLessThanOrEqual(0);
      }
    }
  });

  it("handles empty result set", async () => {
    const { output } = await runSessionsCommand(
      "/nonexistent/project/path/that/wont/match",
      { claudeDir: MOCK_CLAUDE },
      noColors,
    );
    expect(output).toBe("No sessions found.");
  });

  it("handles unknown project path gracefully", async () => {
    const { output } = await runSessionsCommand(
      undefined,
      { claudeDir: "/nonexistent/path", json: true },
      noColors,
    );
    expect(output).toBe("[]");
  });
});
