import { describe, it, expect } from "vitest";
import {
  parseHistoryBySession,
  streamHistory,
} from "../src/core/history-parser.js";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, "fixtures");
const MOCK_CLAUDE = path.join(FIXTURES, "mock-claude-dir");

describe("parseHistoryBySession", () => {
  it("groups history entries by sessionId", async () => {
    const map = await parseHistoryBySession({ claudeDir: MOCK_CLAUDE });
    const orphan = map.get("11111111-2222-3333-4444-555555555555");
    expect(orphan).toBeDefined();
    expect(orphan!.promptCount).toBe(2);
  });

  it("tracks first and last timestamps per session", async () => {
    const map = await parseHistoryBySession({ claudeDir: MOCK_CLAUDE });
    const orphan = map.get("11111111-2222-3333-4444-555555555555")!;
    expect(orphan.firstTimestamp).toBe(1700000000000);
    expect(orphan.lastTimestamp).toBe(1700000001000);
  });

  it("includes project path in session data", async () => {
    const map = await parseHistoryBySession({ claudeDir: MOCK_CLAUDE });
    const orphan = map.get("11111111-2222-3333-4444-555555555555")!;
    expect(orphan.project).toBe("/Users/alice/code/orphan-project");
  });

  it("returns empty map when history.jsonl does not exist", async () => {
    const map = await parseHistoryBySession({
      claudeDir: path.join(FIXTURES, "empty-claude-dir"),
    });
    expect(map.size).toBe(0);
  });
});

describe("streamHistory", () => {
  it("invokes callback for each entry", async () => {
    const entries: unknown[] = [];
    await streamHistory(
      (entry) => {
        entries.push(entry);
      },
      { claudeDir: MOCK_CLAUDE },
    );
    expect(entries.length).toBe(3);
  });

  it("stops early when callback returns false", async () => {
    let count = 0;
    const result = await streamHistory(
      () => {
        count++;
        return false;
      },
      { claudeDir: MOCK_CLAUDE },
    );
    expect(result).toBe(1);
    expect(count).toBe(1);
  });
});
