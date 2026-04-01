import { describe, it, expect } from "vitest";
import {
  generateBashCompletions,
  generateZshCompletions,
  generateFishCompletions,
} from "../../src/commands/completions.js";

describe("generateBashCompletions", () => {
  it("returns a non-empty string", () => {
    const script = generateBashCompletions();
    expect(script.length).toBeGreaterThan(0);
  });

  it("contains all subcommands", () => {
    const script = generateBashCompletions();
    expect(script).toContain("projects");
    expect(script).toContain("sessions");
    expect(script).toContain("inspect");
    expect(script).toContain("status");
    expect(script).toContain("serve");
    expect(script).toContain("watch");
    expect(script).toContain("completions");
  });

  it("contains the complete function registration", () => {
    const script = generateBashCompletions();
    expect(script).toContain("complete -F");
    expect(script).toContain("claude-agents");
  });

  it("includes --format option for sessions", () => {
    const script = generateBashCompletions();
    expect(script).toContain("--format");
    expect(script).toContain("csv");
  });
});

describe("generateZshCompletions", () => {
  it("returns a non-empty string", () => {
    const script = generateZshCompletions();
    expect(script.length).toBeGreaterThan(0);
  });

  it("contains compdef directive", () => {
    const script = generateZshCompletions();
    expect(script).toContain("#compdef claude-agents");
  });

  it("contains all subcommands with descriptions", () => {
    const script = generateZshCompletions();
    expect(script).toContain("projects:");
    expect(script).toContain("sessions:");
    expect(script).toContain("inspect:");
    expect(script).toContain("watch:");
  });
});

describe("generateFishCompletions", () => {
  it("returns a non-empty string", () => {
    const script = generateFishCompletions();
    expect(script.length).toBeGreaterThan(0);
  });

  it("contains fish complete commands", () => {
    const script = generateFishCompletions();
    expect(script).toContain("complete -c claude-agents");
  });

  it("contains all subcommands", () => {
    const script = generateFishCompletions();
    expect(script).toContain("projects");
    expect(script).toContain("sessions");
    expect(script).toContain("inspect");
    expect(script).toContain("watch");
    expect(script).toContain("completions");
  });

  it("includes CSV format option", () => {
    const script = generateFishCompletions();
    expect(script).toContain("csv");
  });
});
