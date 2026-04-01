import { describe, it, expect } from "vitest";
import { scanProjectDirs, getProjectsDir } from "../src/core/scanner.js";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, "fixtures");

describe("getProjectsDir", () => {
  it("uses the provided claudeDir", () => {
    const result = getProjectsDir({ claudeDir: "/custom/path" });
    expect(result).toBe("/custom/path/projects");
  });

  it("defaults to ~/.claude when no claudeDir provided", () => {
    const result = getProjectsDir();
    expect(result).toMatch(/\.claude\/projects$/);
  });
});

describe("scanProjectDirs", () => {
  it("returns all directory names from the projects folder", async () => {
    const dirs = await scanProjectDirs({
      claudeDir: path.join(FIXTURES, "mock-claude-dir"),
    });
    expect(dirs).toContain("-Users-alice-projects-my-app");
    expect(dirs).toContain("-Users-alice-projects-my-dotted-project");
    expect(dirs).toContain("-Users-alice-code-orphan-project");
    expect(dirs).toContain("-Users-alice-unknown-thing");
  });

  it("does not include files (only directories)", async () => {
    const dirs = await scanProjectDirs({
      claudeDir: path.join(FIXTURES, "mock-claude-dir"),
    });
    expect(dirs).not.toContain("not-a-directory.txt");
  });

  it("returns sorted directory names", async () => {
    const dirs = await scanProjectDirs({
      claudeDir: path.join(FIXTURES, "mock-claude-dir"),
    });
    const sorted = [...dirs].sort();
    expect(dirs).toEqual(sorted);
  });

  it("returns empty array when projects directory does not exist", async () => {
    const dirs = await scanProjectDirs({
      claudeDir: path.join(FIXTURES, "empty-claude-dir"),
    });
    expect(dirs).toEqual([]);
  });

  it("returns empty array when claude dir does not exist at all", async () => {
    const dirs = await scanProjectDirs({
      claudeDir: "/nonexistent/path/that/does/not/exist",
    });
    expect(dirs).toEqual([]);
  });
});
