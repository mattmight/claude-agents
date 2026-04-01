import { describe, it, expect } from "vitest";
import { parseDuration } from "../../src/utils/duration.js";

describe("parseDuration", () => {
  it("parses seconds", () => {
    expect(parseDuration("30s")).toBe(30_000);
  });

  it("parses minutes", () => {
    expect(parseDuration("5m")).toBe(300_000);
  });

  it("parses hours", () => {
    expect(parseDuration("1h")).toBe(3_600_000);
  });

  it("parses days", () => {
    expect(parseDuration("7d")).toBe(604_800_000);
  });

  it("parses weeks", () => {
    expect(parseDuration("2w")).toBe(1_209_600_000);
  });

  it("is case-insensitive", () => {
    expect(parseDuration("1H")).toBe(3_600_000);
    expect(parseDuration("7D")).toBe(604_800_000);
  });

  it("throws on invalid format", () => {
    expect(() => parseDuration("abc")).toThrow("Invalid duration");
  });

  it("throws on missing unit", () => {
    expect(() => parseDuration("123")).toThrow("Invalid duration");
  });

  it("throws on empty string", () => {
    expect(() => parseDuration("")).toThrow("Invalid duration");
  });

  it("throws on negative value", () => {
    expect(() => parseDuration("-1h")).toThrow("Invalid duration");
  });
});
