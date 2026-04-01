import { describe, it, expect } from "vitest";
import { createColors } from "../../src/utils/colors.js";

describe("createColors", () => {
  it("wraps strings in ANSI codes when enabled", () => {
    const c = createColors(true);
    expect(c.bold("hi")).toContain("\x1b[1m");
    expect(c.bold("hi")).toContain("hi");
    expect(c.green("ok")).toContain("\x1b[32m");
  });

  it("returns plain strings when disabled", () => {
    const c = createColors(false);
    expect(c.bold("hi")).toBe("hi");
    expect(c.dim("hi")).toBe("hi");
    expect(c.red("hi")).toBe("hi");
    expect(c.green("hi")).toBe("hi");
    expect(c.yellow("hi")).toBe("hi");
    expect(c.cyan("hi")).toBe("hi");
  });

  it("bold adds correct prefix and suffix", () => {
    const c = createColors(true);
    expect(c.bold("test")).toBe("\x1b[1mtest\x1b[22m");
  });
});
