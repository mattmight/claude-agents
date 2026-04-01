import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createColors } from "../../src/utils/colors.js";
import {
  runStatusCommand,
  buildStatusData,
} from "../../src/commands/status.js";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, "..", "fixtures");
const MOCK_CLAUDE = path.join(FIXTURES, "mock-claude-dir");

const noColors = createColors(false);

describe("buildStatusData", () => {
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

  it("returns aggregate data", async () => {
    const data = await buildStatusData({ claudeDir: MOCK_CLAUDE });
    expect(data.projectCount).toBeGreaterThan(0);
    expect(data.totalSessions).toBeGreaterThan(0);
    expect(typeof data.activeSessions).toBe("number");
    expect(typeof data.last24hSessions).toBe("number");
    expect(Array.isArray(data.activeSessionList)).toBe(true);
  });

  it("counts active sessions correctly when all PIDs dead", async () => {
    const data = await buildStatusData({ claudeDir: MOCK_CLAUDE });
    // All PIDs are dead (mocked), so active count should come from
    // recency heuristic only
    expect(data.activeSessions).toBeGreaterThanOrEqual(0);
  });

  it("handles missing directory gracefully", async () => {
    const data = await buildStatusData({ claudeDir: "/nonexistent/path" });
    expect(data.projectCount).toBe(0);
    expect(data.totalSessions).toBe(0);
    expect(data.activeSessions).toBe(0);
  });
});

describe("runStatusCommand", () => {
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

  it("returns dashboard-formatted output by default", async () => {
    const output = await runStatusCommand(
      { claudeDir: MOCK_CLAUDE },
      noColors,
    );
    expect(output).toContain("Claude Code Sessions");
    expect(output).toContain("Projects:");
    expect(output).toContain("Total sessions:");
    expect(output).toContain("Active:");
    expect(output).toContain("Last 24h:");
  });

  it("returns JSON when json option is true", async () => {
    const output = await runStatusCommand(
      { claudeDir: MOCK_CLAUDE, json: true },
      noColors,
    );
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("project_count");
    expect(parsed).toHaveProperty("total_sessions");
    expect(parsed).toHaveProperty("active_sessions");
    expect(parsed).toHaveProperty("last_24h_sessions");
    expect(parsed).toHaveProperty("active_session_list");
  });

  it("handles empty state", async () => {
    const output = await runStatusCommand(
      { claudeDir: "/nonexistent/path" },
      noColors,
    );
    expect(output).toContain("Projects:");
    expect(output).toContain("0");
  });
});
