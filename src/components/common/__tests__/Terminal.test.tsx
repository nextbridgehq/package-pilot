import React, { createRef } from "react";
import { render, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { Terminal, type TerminalRef } from "../Terminal";
import { useSettingsStore } from "../../../store/useSettingsStore";

vi.mock("../../../services/terminalConfig", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../services/terminalConfig")>();
  return { ...actual, createConfiguredTerminal: vi.fn(actual.createConfiguredTerminal) };
});

import { createConfiguredTerminal } from "../../../services/terminalConfig";

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
const createConfiguredTerminalMock = createConfiguredTerminal as unknown as ReturnType<typeof vi.fn>;
const callsTo = (cmd: string) => invokeMock.mock.calls.filter(([c]) => c === cmd);

describe("embedded Terminal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("exposes write so LinkManager can print smoke-test output", () => {
    const ref = createRef<TerminalRef>();
    render(<Terminal directory="/repo" sessionId="t1" ref={ref} />);
    expect(typeof ref.current?.write).toBe("function");
    // Must not throw - this call is live in LinkManager today.
    expect(() => ref.current!.write("hello\r\n")).not.toThrow();
  });

  it("exposes writeCommand for sending input to the shell", async () => {
    const ref = createRef<TerminalRef>();
    render(<Terminal directory="/repo" sessionId="t2" ref={ref} />);
    await waitFor(() => expect(callsTo("spawn_pty").length).toBeGreaterThan(0));

    invokeMock.mockClear();
    ref.current!.writeCommand("npm test");
    expect(callsTo("write_pty")).toHaveLength(1);
    expect(callsTo("write_pty")[0][1].data).toBe("npm test\r");
  });

  it("spawns with explicit dimensions", async () => {
    render(<Terminal directory="/repo" sessionId="t3" />);
    await waitFor(() => expect(callsTo("spawn_pty")).toHaveLength(1));
    const [, args] = callsTo("spawn_pty")[0];
    expect(typeof args.cols).toBe("number");
    expect(typeof args.rows).toBe("number");
  });

  it("always uses the dark theme to ensure white text visibility on dark background", () => {
    useSettingsStore.setState({ theme: "light" });
    render(<Terminal directory="/repo" sessionId="t4" />);
    expect(createConfiguredTerminalMock).toHaveBeenCalledWith("dark");
  });
});
