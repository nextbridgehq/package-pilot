import { describe, it, expect, vi, beforeEach } from "vitest";
import { useLogStore } from "./useLogStore";
import { logApi } from "../services/tauriApi";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

vi.mock("../services/tauriApi", () => ({
  logApi: {
    getLogs: vi.fn(),
    clearLogs: vi.fn(),
  },
}));

describe("useLogStore", () => {
  beforeEach(() => {
    useLogStore.setState({ logs: [], loading: false });
    vi.clearAllMocks();
  });

  it("reverses the backend's oldest-first order to newest-first for display", async () => {
    vi.mocked(logApi.getLogs).mockResolvedValue([
      { id: "1", timestamp: "t1", level: "info", message: "first", source: "Test" },
      { id: "2", timestamp: "t2", level: "info", message: "second", source: "Test" },
    ]);

    await useLogStore.getState().fetchLogs();

    const logs = useLogStore.getState().logs;
    expect(logs.map((l) => l.message)).toEqual(["second", "first"]);
    expect(useLogStore.getState().loading).toBe(false);
  });

  it("does not throw and stops loading when the backend fetch rejects", async () => {
    vi.mocked(logApi.getLogs).mockRejectedValue(new Error("boom"));

    await useLogStore.getState().fetchLogs();

    expect(useLogStore.getState().loading).toBe(false);
    expect(useLogStore.getState().logs).toEqual([]);
  });

  it("clearLogs calls the backend and empties local state only on success", async () => {
    useLogStore.setState({
      logs: [{ id: "1", timestamp: "t1", level: "info", message: "x", source: "Test" }],
    });
    vi.mocked(logApi.clearLogs).mockResolvedValue(undefined);

    await useLogStore.getState().clearLogs();

    expect(logApi.clearLogs).toHaveBeenCalledTimes(1);
    expect(useLogStore.getState().logs).toEqual([]);
  });

  it("clearLogs leaves existing entries in place if the backend call fails", async () => {
    const existing = [{ id: "1", timestamp: "t1", level: "info" as const, message: "x", source: "Test" }];
    useLogStore.setState({ logs: existing });
    vi.mocked(logApi.clearLogs).mockRejectedValue(new Error("boom"));

    await useLogStore.getState().clearLogs();

    expect(useLogStore.getState().logs).toEqual(existing);
  });

  it("addLog prepends new entries, capped at 500", () => {
    useLogStore.getState().addLog({ level: "success", message: "hello", source: "Test" });

    const logs = useLogStore.getState().logs;
    expect(logs).toHaveLength(1);
    expect(logs[0].message).toBe("hello");
    expect(logs[0].id).toBeTruthy();
    expect(logs[0].timestamp).toBeTruthy();
  });
});
