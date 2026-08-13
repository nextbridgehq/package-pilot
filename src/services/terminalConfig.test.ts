import { describe, it, expect } from "vitest";
import {
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE,
  buildTerminalTheme,
  shouldXtermConsumeKey,
  resolveTerminalMode,
} from "./terminalConfig";

const HEX = /^#[0-9a-fA-F]{6}$/;

describe("terminal font", () => {
  // Inter is proportional. xterm assumes a fixed cell width, so a
  // proportional face makes glyphs overlap - this was the original bug.
  it("contains no proportional faces", () => {
    expect(TERMINAL_FONT_FAMILY).not.toMatch(/Inter/i);
    expect(TERMINAL_FONT_FAMILY).not.toMatch(/Segoe UI/i);
    expect(TERMINAL_FONT_FAMILY).not.toMatch(/Arial|Helvetica/i);
  });

  it("ends in a guaranteed monospace fallback", () => {
    expect(TERMINAL_FONT_FAMILY).toMatch(/Consolas/);
    expect(TERMINAL_FONT_FAMILY.trim()).toMatch(/monospace$/);
  });

  it("uses a readable size", () => {
    expect(TERMINAL_FONT_SIZE).toBeGreaterThanOrEqual(12);
    expect(TERMINAL_FONT_SIZE).toBeLessThanOrEqual(16);
  });
});

describe.each(["dark", "light"] as const)("buildTerminalTheme(%s)", (mode) => {
  const theme = buildTerminalTheme(mode);

  // Fluent tokens evaluate to "var(--colorNeutralBackground1)", which
  // xterm's colour parser cannot resolve. Locking this out permanently.
  it("emits no CSS custom properties", () => {
    for (const [key, value] of Object.entries(theme)) {
      expect(String(value), `${key} must not be a CSS var`).not.toContain("var(");
    }
  });

  it("emits only literal hex colours", () => {
    for (const [key, value] of Object.entries(theme)) {
      expect(String(value), `${key} must be hex`).toMatch(HEX);
    }
  });

  it("defines the full 16-colour ANSI set plus core slots", () => {
    for (const key of [
      "background", "foreground", "cursor", "selectionBackground",
      "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
      "brightBlack", "brightRed", "brightGreen", "brightYellow",
      "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
    ]) {
      expect(theme, `missing ${key}`).toHaveProperty(key);
    }
  });
});

describe("shouldXtermConsumeKey", () => {
  // Ctrl+` must reach the window listener so the panel toggle works while
  // the terminal has focus - xterm must NOT consume it.
  it("does not consume Ctrl+`, so it bubbles to the window listener", () => {
    expect(shouldXtermConsumeKey({ ctrlKey: true, key: "`" })).toBe(false);
  });

  // Esc must never close the panel - it is load-bearing inside a terminal
  // (readline, vim) and must still reach the shell.
  it("consumes Escape normally, so it still reaches the shell", () => {
    expect(shouldXtermConsumeKey({ ctrlKey: false, key: "Escape" })).toBe(true);
  });
});

describe("resolveTerminalMode", () => {
  it("passes light and dark through unchanged", () => {
    expect(resolveTerminalMode("light")).toBe("light");
    expect(resolveTerminalMode("dark")).toBe("dark");
  });

  it("resolves system to dark when the OS prefers dark", () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;

    expect(resolveTerminalMode("system")).toBe("dark");
    window.matchMedia = original;
  });

  it("resolves system to light when the OS does not prefer dark", () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;

    expect(resolveTerminalMode("system")).toBe("light");
    window.matchMedia = original;
  });
});
