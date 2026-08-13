import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "../store/useSettingsStore";

vi.mock("./terminalConfig", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./terminalConfig")>();
  return { ...actual, createConfiguredTerminal: vi.fn(actual.createConfiguredTerminal) };
});

import { createConfiguredTerminal } from "./terminalConfig";
import { getTerminalInstance, deleteTerminalInstance } from "./terminalService";

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
const createConfiguredTerminalMock = createConfiguredTerminal as unknown as ReturnType<typeof vi.fn>;

describe("terminalService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({ theme: "light" });
  });

  // Fix 8: freshly-created terminals must follow the app's theme setting
  // instead of always hardcoding "dark".
  it("creates a new instance using the app's light theme setting", () => {
    useSettingsStore.setState({ theme: "light" });
    getTerminalInstance("theme-light");
    expect(createConfiguredTerminalMock).toHaveBeenCalledWith("light");
  });

  it("creates a new instance using the app's dark theme setting", () => {
    useSettingsStore.setState({ theme: "dark" });
    getTerminalInstance("theme-dark");
    expect(createConfiguredTerminalMock).toHaveBeenCalledWith("dark");
  });

  it("resolves a system theme setting via the OS preference", () => {
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

    useSettingsStore.setState({ theme: "system" });
    getTerminalInstance("theme-system");
    expect(createConfiguredTerminalMock).toHaveBeenCalledWith("dark");

    window.matchMedia = original;
  });

  // Fix 7: closing a tab that was opened but never activated (so it was
  // never registered via getTerminalInstance) must still kill its backend
  // PTY - otherwise it leaks a process.
  it("kills the backend PTY even for a session that was never mounted/registered", () => {
    deleteTerminalInstance("never-mounted");
    const kills = invokeMock.mock.calls.filter(([c]) => c === "kill_pty");
    expect(kills).toHaveLength(1);
    expect(kills[0][1]).toEqual({ sessionId: "never-mounted" });
  });

  it("still kills the backend PTY for a session that was registered", () => {
    getTerminalInstance("was-mounted");
    deleteTerminalInstance("was-mounted");
    const kills = invokeMock.mock.calls.filter(([c]) => c === "kill_pty");
    expect(kills).toHaveLength(1);
    expect(kills[0][1]).toEqual({ sessionId: "was-mounted" });
  });
});
