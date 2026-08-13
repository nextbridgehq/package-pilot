import { describe, it, expect, vi, beforeEach } from "vitest";
import { useWatcherStore } from "./useWatcherStore";
import { commands } from "../bindings";

vi.mock("../bindings", () => ({
  commands: {
    getWatcherStatus: vi.fn(),
    startWatching: vi.fn(),
    stopWatching: vi.fn(),
  },
}));

describe("useWatcherStore", () => {
  beforeEach(() => {
    useWatcherStore.setState({ watcherStatus: {}, events: [] });
    vi.clearAllMocks();
  });

  it("keeps watcherStatus as an object when the backend resolves an ok status with no data", async () => {
    vi.mocked(commands.getWatcherStatus).mockResolvedValue({
      status: "ok",
      data: undefined as unknown as Record<string, boolean>,
    });

    await useWatcherStore.getState().fetchStatus();

    expect(useWatcherStore.getState().watcherStatus).toEqual({});
  });

  it("adopts a valid status map from the backend", async () => {
    vi.mocked(commands.getWatcherStatus).mockResolvedValue({ status: "ok", data: { "link-1": true } });

    await useWatcherStore.getState().fetchStatus();

    expect(useWatcherStore.getState().watcherStatus).toEqual({ "link-1": true });
  });

  it("resets watcherStatus to an empty object when the backend returns an error", async () => {
    vi.mocked(commands.getWatcherStatus).mockResolvedValue({ status: "error", error: "boom" });

    await useWatcherStore.getState().fetchStatus();

    expect(useWatcherStore.getState().watcherStatus).toEqual({});
  });
});
