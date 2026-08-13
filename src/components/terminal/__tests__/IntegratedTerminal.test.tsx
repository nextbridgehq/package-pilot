import React from "react";
import { render, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { IntegratedTerminal } from "../IntegratedTerminal";
import { getTerminalInstance, deleteTerminalInstance } from "../../../services/terminalService";

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
const callsTo = (cmd: string) => invokeMock.mock.calls.filter(([c]) => c === cmd);

describe("IntegratedTerminal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("spawns the PTY with explicit dimensions, never the hardcoded default", async () => {
    render(<IntegratedTerminal sessionId="s1" cwd="/repo" />);

    await waitFor(() => expect(callsTo("spawn_pty")).toHaveLength(1));
    const [, args] = callsTo("spawn_pty")[0];
    expect(args.sessionId).toBe("s1");
    expect(args.directory).toBe("/repo");
    expect(typeof args.cols).toBe("number");
    expect(typeof args.rows).toBe("number");
  });

  it("pushes the fitted size to the PTY after spawning", async () => {
    render(<IntegratedTerminal sessionId="s2" cwd="/repo" />);
    await waitFor(() => expect(callsTo("resize_pty").length).toBeGreaterThan(0));
    const [, args] = callsTo("resize_pty")[0];
    expect(args.sessionId).toBe("s2");
    expect(args.rows).toBeGreaterThan(0);
    expect(args.cols).toBeGreaterThan(0);
  });

  it("does not kill the session when it unmounts", () => {
    // Sessions outlive the view so a dev server survives closing the panel.
    const { unmount } = render(<IntegratedTerminal sessionId="s3" cwd="/repo" />);
    unmount();
    expect(callsTo("kill_pty")).toHaveLength(0);
  });

  // Fix 1: a queued command must never be written before spawn_pty confirms
  // the PTY exists for this session.
  it("writes the initial command only after spawn_pty resolves, in order", async () => {
    render(<IntegratedTerminal sessionId="s-cold" cwd="/repo" initialCommand="npm install -g pnpm" />);

    await waitFor(() => {
      const writes = invokeMock.mock.calls.filter(
        ([c, args]) => c === "write_pty" && (args as { data?: string })?.data === "npm install -g pnpm\r",
      );
      expect(writes).toHaveLength(1);
    });

    const spawnIndex = invokeMock.mock.calls.findIndex(([c]) => c === "spawn_pty");
    const writeIndex = invokeMock.mock.calls.findIndex(
      ([c, args]) => c === "write_pty" && (args as { data?: string })?.data === "npm install -g pnpm\r",
    );
    expect(spawnIndex).toBeGreaterThanOrEqual(0);
    expect(writeIndex).toBeGreaterThan(spawnIndex);
  });

  it("clears the initial command via the consumed callback after writing it", async () => {
    const onConsumed = vi.fn();
    render(
      <IntegratedTerminal
        sessionId="s-cold-2"
        cwd="/repo"
        initialCommand="npm run fix"
        onInitialCommandConsumed={onConsumed}
      />,
    );
    await waitFor(() => expect(onConsumed).toHaveBeenCalledTimes(1));
  });

  // Fix 3: a background tab's output must not be lost before its first
  // activation - IntegratedTerminal must attach and replay backend history
  // rather than always spawning fresh.
  it("replays existing backend history instead of spawning a second shell", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "attach_pty") return Promise.resolve("previous output\r\n");
      return Promise.resolve();
    });

    const instance = getTerminalInstance("s-reattach");
    const writeSpy = vi.spyOn(instance.term, "write");

    render(<IntegratedTerminal sessionId="s-reattach" cwd="/repo" />);

    await waitFor(() => {
      expect(writeSpy.mock.calls.some(([data]) => data === "previous output\r\n")).toBe(true);
    });
    expect(callsTo("spawn_pty")).toHaveLength(0);
  });

  // Fix 4: a spawn failure (bad cwd, session cap, security gate) must not be
  // silently swallowed - it must surface in the terminal itself.
  it("shows an error in the terminal when spawn_pty rejects", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "spawn_pty") return Promise.reject(new Error("boom"));
      return Promise.resolve();
    });

    const instance = getTerminalInstance("s-spawn-fail");
    const writeSpy = vi.spyOn(instance.term, "write");

    render(<IntegratedTerminal sessionId="s-spawn-fail" cwd="/repo" />);

    await waitFor(() => {
      expect(
        writeSpy.mock.calls.some(
          ([data]) => typeof data === "string" && data.includes("Error initializing terminal"),
        ),
      ).toBe(true);
    });
  });

  // A tab closed in the narrow window between attach resolving and spawn
  // being called must not still spawn an orphan PTY for a session whose
  // teardown (kill_pty) has already fired.
  it("does not spawn a PTY for a session closed while attach was pending", async () => {
    let resolveAttach!: (value: string | null) => void;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "attach_pty") return new Promise((resolve) => { resolveAttach = resolve; });
      return Promise.resolve();
    });

    render(<IntegratedTerminal sessionId="s-close-race" cwd="/repo" />);
    await waitFor(() => expect(resolveAttach).toBeDefined());

    // Simulate the tab being closed (as TerminalPanel.handleClose does)
    // while attach is still in flight.
    deleteTerminalInstance("s-close-race");
    resolveAttach(null);

    // Give the resumed async setup a tick to reach (and be stopped by) the
    // post-attach deleted check.
    await new Promise((r) => setTimeout(r, 0));
    expect(callsTo("spawn_pty")).toHaveLength(0);
  });

  // A queued command handed to a session that turns out to be a reattach
  // (already running - Fix 3) is never written, but the caller's ref entry
  // for it must still be released or it leaks for the session's lifetime.
  it("still clears a queued initial command when the session is a reattach, not a fresh spawn", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "attach_pty") return Promise.resolve("already running\r\n");
      return Promise.resolve();
    });
    const onConsumed = vi.fn();

    render(
      <IntegratedTerminal
        sessionId="s-reattach-with-command"
        cwd="/repo"
        initialCommand="echo hi"
        onInitialCommandConsumed={onConsumed}
      />,
    );

    await waitFor(() => expect(onConsumed).toHaveBeenCalledTimes(1));
    expect(callsTo("write_pty").some(([, args]) => (args as { data?: string })?.data === "echo hi\r")).toBe(false);
  });

  // Same leak, different path: a rejected spawn must also release the ref
  // entry, not just the successful-write path.
  it("still clears a queued initial command when spawn_pty rejects", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "spawn_pty") return Promise.reject(new Error("boom"));
      return Promise.resolve();
    });
    const onConsumed = vi.fn();

    render(
      <IntegratedTerminal
        sessionId="s-spawn-fail-with-command"
        cwd="/repo"
        initialCommand="echo hi"
        onInitialCommandConsumed={onConsumed}
      />,
    );

    await waitFor(() => expect(onConsumed).toHaveBeenCalledTimes(1));
  });
});
