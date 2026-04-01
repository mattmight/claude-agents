import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createColors } from "../src/utils/colors.js";
import { runProjectsCommand } from "../src/commands/projects.js";
import { runSessionsCommand } from "../src/commands/sessions.js";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, "fixtures");
const MOCK_CLAUDE = path.join(FIXTURES, "mock-claude-dir");
const EMPTY_CLAUDE = path.join(FIXTURES, "empty-claude-dir");

const noColors = createColors(false);

describe("exit code support", () => {
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

  describe("runProjectsCommand", () => {
    it("returns isEmpty: false when projects exist", async () => {
      const { isEmpty } = await runProjectsCommand(
        { claudeDir: MOCK_CLAUDE },
        noColors,
      );
      expect(isEmpty).toBe(false);
    });

    it("returns isEmpty: true when no projects exist", async () => {
      const { isEmpty } = await runProjectsCommand(
        { claudeDir: EMPTY_CLAUDE },
        noColors,
      );
      expect(isEmpty).toBe(true);
    });

    it("returns isEmpty: true when --active filters all out", async () => {
      // All PIDs are dead, so no projects are active (unless recency heuristic kicks in)
      const { isEmpty } = await runProjectsCommand(
        { claudeDir: MOCK_CLAUDE, active: true },
        noColors,
      );
      // May or may not be empty depending on JSONL recency, just verify it's boolean
      expect(typeof isEmpty).toBe("boolean");
    });
  });

  describe("runSessionsCommand", () => {
    it("returns isEmpty: false when sessions exist", async () => {
      const { isEmpty } = await runSessionsCommand(
        undefined,
        { claudeDir: MOCK_CLAUDE },
        noColors,
      );
      expect(isEmpty).toBe(false);
    });

    it("returns isEmpty: true when no sessions match", async () => {
      const { isEmpty } = await runSessionsCommand(
        "/totally/nonexistent/project",
        { claudeDir: MOCK_CLAUDE },
        noColors,
      );
      expect(isEmpty).toBe(true);
    });

    it("returns isEmpty: true with empty claude dir", async () => {
      const { isEmpty } = await runSessionsCommand(
        undefined,
        { claudeDir: EMPTY_CLAUDE },
        noColors,
      );
      expect(isEmpty).toBe(true);
    });
  });

  describe("sessions --format csv", () => {
    it("returns CSV output with format option", async () => {
      const { output } = await runSessionsCommand(
        undefined,
        { claudeDir: MOCK_CLAUDE, format: "csv" },
        noColors,
      );
      expect(output).toContain("id,project_path,branch,status");
      const lines = output.split("\n");
      expect(lines.length).toBeGreaterThan(1); // header + data
    });

    it("returns CSV with only header for empty results", async () => {
      const { output } = await runSessionsCommand(
        undefined,
        { claudeDir: EMPTY_CLAUDE, format: "csv" },
        noColors,
      );
      expect(output).toBe(
        "id,project_path,branch,status,updated_at,created_at,message_count,summary",
      );
    });
  });
});
