import React from "react";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TerminalPanel } from "../TerminalPanel";
import { useTerminalStore } from "../../../store/useTerminalStore";
import { IPC_EVENTS } from "../../../constants/ipc";

vi.mock("../IntegratedTerminal", () => ({
  IntegratedTerminal: ({
    sessionId,
    initialCommand,
  }: {
    sessionId: string;
    initialCommand?: string;
  }) => (
    <div
      data-testid="integrated-terminal"
      data-session={sessionId}
      data-initial-command={initialCommand ?? ""}
    />
  ),
}));

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
const killCalls = () => invokeMock.mock.calls.filter(([c]) => c === "kill_pty");

const renderPanel = () =>
  render(
    <FluentProvider theme={webLightTheme}>
      <TerminalPanel />
    </FluentProvider>,
  );

const session = (id: string) => ({ id, title: id, cwd: "/repo" });

describe("TerminalPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useTerminalStore.setState({
      isOpen: false,
      sessions: [],
      activeSessionId: null,
      splitSessionId: null,
      pendingCommand: null,
    });
  });

  // Lazy mount: no PowerShell process at application startup.
  it("mounts no terminal while closed", () => {
    renderPanel();
    expect(screen.queryByTestId("integrated-terminal")).toBeNull();
  });

  it("mounts only the active session's terminal once opened", () => {
    renderPanel();
    act(() => {
      useTerminalStore.getState().openWithSessions([session("a"), session("b")]);
    });
    const mounted = screen.getAllByTestId("integrated-terminal");
    expect(mounted).toHaveLength(1);
    expect(mounted[0]).toHaveAttribute("data-session", "a");
  });

  // The regression that froze the whole app: kill_pty on every render.
  it("does not kill a session on an unrelated re-render", () => {
    renderPanel();
    act(() => {
      useTerminalStore.getState().openWithSession(session("a"));
    });
    invokeMock.mockClear();
    act(() => {
      useTerminalStore.getState().togglePanel();
      useTerminalStore.getState().togglePanel();
    });
    expect(killCalls()).toHaveLength(0);
  });

  it("keeps sessions alive when the panel is closed", () => {
    renderPanel();
    act(() => {
      useTerminalStore.getState().openWithSession(session("a"));
    });
    invokeMock.mockClear();
    act(() => {
      useTerminalStore.getState().closePanel();
    });
    expect(killCalls()).toHaveLength(0);
    expect(useTerminalStore.getState().sessions).toHaveLength(1);
  });

  it("kills only the closed tab's session", async () => {
    const user = userEvent.setup();
    renderPanel();
    act(() => {
      useTerminalStore.getState().openWithSessions([session("a"), session("b")]);
    });
    invokeMock.mockClear();
    await user.click(screen.getByRole("button", { name: /close b/i }));

    expect(killCalls()).toHaveLength(1);
    expect(killCalls()[0][1]).toEqual({ sessionId: "b" });
  });

  it("toggles with Ctrl+`", async () => {
    const user = userEvent.setup();
    renderPanel();
    act(() => {
      useTerminalStore.getState().openWithSession(session("a"));
      useTerminalStore.getState().closePanel();
    });
    await user.keyboard("{Control>}`{/Control}");
    expect(useTerminalStore.getState().isOpen).toBe(true);
  });

  it("creates a session and hands the queued fix command to its terminal exactly once", async () => {
    renderPanel();
    act(() => {
      useTerminalStore.getState().openWithCommand("npm install -g pnpm");
    });

    await vi.waitFor(() => {
      expect(useTerminalStore.getState().sessions).toHaveLength(1);
    });

    // The command is handed to IntegratedTerminal as initialCommand, not
    // written directly here - the PTY doesn't exist yet at this point, so
    // TerminalPanel itself must never call write_pty for the cold-start case.
    const terminal = screen.getByTestId("integrated-terminal");
    expect(terminal).toHaveAttribute("data-initial-command", "npm install -g pnpm");
    expect(useTerminalStore.getState().pendingCommand).toBeNull();
    expect(invokeMock.mock.calls.filter(([c]) => c === "write_pty")).toHaveLength(0);
  });

  it("writes directly when a session is already active (no ordering hazard)", async () => {
    renderPanel();
    act(() => {
      useTerminalStore.getState().openWithSession(session("a"));
    });
    invokeMock.mockClear();
    act(() => {
      useTerminalStore.getState().openWithCommand("npm test");
    });

    await vi.waitFor(() => {
      const writes = invokeMock.mock.calls.filter(([c]) => c === "write_pty");
      expect(writes).toHaveLength(1);
      expect(writes[0][1].data).toBe("npm test\r");
    });
  });

  // Fix 2 regression: clicking the split pane's own tab used to leave
  // splitSessionId pointing at the now-active session, rendering it twice.
  it("renders a session only once even if it is both active and the split pane", () => {
    renderPanel();
    act(() => {
      useTerminalStore.getState().openWithSessions([session("a"), session("b")]);
      useTerminalStore.getState().setSplitSession("b");
      useTerminalStore.getState().setActiveSession("b");
    });
    const mounted = screen.getAllByTestId("integrated-terminal");
    expect(mounted).toHaveLength(1);
    expect(mounted[0]).toHaveAttribute("data-session", "b");
  });

  // A background dev-server tab that crashes must show *something* even
  // though it's never been the active tab - this is the frontend half of
  // the backend's organic-exit event.
  it("marks a session exited when a pty-exit event arrives for it", async () => {
    const listenMock = vi.mocked(listen);
    let ptyExitHandler: ((event: { payload: { session_id: string } }) => void) | undefined;
    listenMock.mockImplementation((eventName: string, handler: any) => {
      if (eventName === IPC_EVENTS.PTY_EXIT) ptyExitHandler = handler;
      return Promise.resolve(() => {});
    });

    renderPanel();
    act(() => {
      useTerminalStore.getState().openWithSessions([session("a"), session("b")]);
    });

    await vi.waitFor(() => expect(ptyExitHandler).toBeDefined());
    act(() => {
      ptyExitHandler!({ payload: { session_id: "b" } });
    });

    const s = useTerminalStore.getState();
    expect(s.exitedSessionIds.has("b")).toBe(true);
    expect(s.exitedSessionIds.has("a")).toBe(false);

    // Restore the shared mock's default so later tests in other files aren't
    // affected by this test's custom implementation.
    listenMock.mockImplementation(() => Promise.resolve(() => {}));
  });
});
