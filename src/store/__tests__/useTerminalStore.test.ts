import { describe, it, expect, beforeEach } from "vitest";
import { useTerminalStore } from "../useTerminalStore";

const reset = () =>
  useTerminalStore.setState({
    isOpen: false,
    sessions: [],
    activeSessionId: null,
    splitSessionId: null,
    pendingCommand: null,
    exitedSessionIds: new Set(),
  });

const session = (id: string) => ({ id, title: id, cwd: "/repo" });

describe("useTerminalStore", () => {
  beforeEach(reset);

  it("opens one tab and activates it", () => {
    useTerminalStore.getState().openWithSession(session("a"));
    const s = useTerminalStore.getState();
    expect(s.isOpen).toBe(true);
    expect(s.sessions.map((x) => x.id)).toEqual(["a"]);
    expect(s.activeSessionId).toBe("a");
  });

  // Run All Dev must produce tabs, not four cramped side-by-side panes.
  it("opens many sessions as tabs and activates the first", () => {
    useTerminalStore.getState().openWithSessions([
      session("api"), session("web"), session("docs"), session("ui"),
    ]);
    const s = useTerminalStore.getState();
    expect(s.sessions).toHaveLength(4);
    expect(s.activeSessionId).toBe("api");
    expect(s.splitSessionId).toBeNull();
  });

  it("does not duplicate a session that is already open", () => {
    useTerminalStore.getState().openWithSession(session("a"));
    useTerminalStore.getState().openWithSession(session("a"));
    expect(useTerminalStore.getState().sessions).toHaveLength(1);
  });

  it("activates a neighbour when the active tab is closed", () => {
    useTerminalStore.getState().openWithSessions([session("a"), session("b")]);
    useTerminalStore.getState().closeSession("a");
    const s = useTerminalStore.getState();
    expect(s.sessions.map((x) => x.id)).toEqual(["b"]);
    expect(s.activeSessionId).toBe("b");
  });

  it("clears the active id when the last tab closes", () => {
    useTerminalStore.getState().openWithSession(session("a"));
    useTerminalStore.getState().closeSession("a");
    expect(useTerminalStore.getState().activeSessionId).toBeNull();
  });

  it("drops the split pane when that session closes", () => {
    useTerminalStore.getState().openWithSessions([session("a"), session("b")]);
    useTerminalStore.getState().setSplitSession("b");
    useTerminalStore.getState().closeSession("b");
    expect(useTerminalStore.getState().splitSessionId).toBeNull();
  });

  it("closing the panel keeps sessions alive", () => {
    useTerminalStore.getState().openWithSession(session("a"));
    useTerminalStore.getState().closePanel();
    const s = useTerminalStore.getState();
    expect(s.isOpen).toBe(false);
    expect(s.sessions).toHaveLength(1);
  });

  // Fix 2: clicking the split pane's own tab must collapse the split,
  // otherwise `visible` ends up with the same session id twice.
  it("clears the split pane id when activating the session shown as the split pane", () => {
    useTerminalStore.getState().openWithSessions([session("a"), session("b")]);
    useTerminalStore.getState().setSplitSession("b");
    useTerminalStore.getState().setActiveSession("b");
    const s = useTerminalStore.getState();
    expect(s.activeSessionId).toBe("b");
    expect(s.splitSessionId).toBeNull();
  });

  it("leaves the split pane id alone when activating a different session", () => {
    useTerminalStore.getState().openWithSessions([session("a"), session("b")]);
    useTerminalStore.getState().setSplitSession("b");
    useTerminalStore.getState().setActiveSession("a");
    expect(useTerminalStore.getState().splitSessionId).toBe("b");
  });

  it("hands a pending command over exactly once", () => {
    useTerminalStore.getState().openWithCommand("npm run fix");
    expect(useTerminalStore.getState().isOpen).toBe(true);
    expect(useTerminalStore.getState().consumePendingCommand()).toBe("npm run fix");
    expect(useTerminalStore.getState().consumePendingCommand()).toBeNull();
  });

  // A shell that exits on its own (typed `exit`, dev server crashed) has no
  // other signal reaching the UI - markSessionExited is that signal.
  it("marks a session exited without touching the others", () => {
    useTerminalStore.getState().openWithSessions([session("a"), session("b")]);
    useTerminalStore.getState().markSessionExited("a");
    const s = useTerminalStore.getState();
    expect(s.exitedSessionIds.has("a")).toBe(true);
    expect(s.exitedSessionIds.has("b")).toBe(false);
  });

  it("clears the exited flag when that tab is closed", () => {
    useTerminalStore.getState().openWithSession(session("a"));
    useTerminalStore.getState().markSessionExited("a");
    useTerminalStore.getState().closeSession("a");
    expect(useTerminalStore.getState().exitedSessionIds.has("a")).toBe(false);
  });
});
