import { describe, it, expect } from "vitest";
import { formatPackageManager, formatLinkMethod } from "./formatters";

describe("formatPackageManager", () => {
  it("formats package manager names correctly", () => {
    expect(formatPackageManager("Npm")).toBe("npm");
    expect(formatPackageManager("Yarn")).toBe("yarn");
    expect(formatPackageManager("Pnpm")).toBe("pnpm");
    expect(formatPackageManager("Bun")).toBe("bun");
    expect(formatPackageManager("Unknown")).toBe("Unknown");
    expect(formatPackageManager("Custom")).toBe("custom");
  });
});

describe("formatLinkMethod", () => {
  it("formats link methods correctly", () => {
    expect(formatLinkMethod("NpmPack")).toBe("npm pack");
    expect(formatLinkMethod("Symlink")).toBe("symlink");
    expect(formatLinkMethod("Yalc")).toBe("yalc");
    expect(formatLinkMethod("Workspace")).toBe("workspace");
  });
});
