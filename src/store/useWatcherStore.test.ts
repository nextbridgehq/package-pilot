import { describe, it, expect, vi, beforeEach } from "vitest";
import { useWatcherStore } from "./useWatcherStore";
import { watcherApi } from "../services/tauriApi";

vi.mock("../services/tauriApi", () => ({
  watcherApi: {
    getWatcherStatus: vi.fn(),
    startWatching: vi.fn(),
    stopWatching: vi.fn(),
  },
}));

describe("useWatcherStore", () => {
  beforeEach(() => {
    useWatcherStore.setState({ watcherStatus: {}, events: [] });
  });

  it("keeps watcherStatus as an object when the backend resolves undefined", async () => {
    vi.mocked(watcherApi.getWatcherStatus).mockResolvedValue(undefined as unknown as Record<string, boolean>);

    await useWatcherStore.getState().fetchStatus();

    expect(useWatcherStore.getState().watcherStatus).toEqual({});
  });

  it("adopts a valid status map from the backend", async () => {
    vi.mocked(watcherApi.getWatcherStatus).mockResolvedValue({ "link-1": true });

    await useWatcherStore.getState().fetchStatus();

    expect(useWatcherStore.getState().watcherStatus).toEqual({ "link-1": true });
  });
});
