import { create } from "zustand";
import { WatcherEvent } from "../types/watcher";
import { commands } from "../bindings";

interface WatcherStore {
  watcherStatus: Record<string, boolean>;
  events: WatcherEvent[];
  
  startWatching: (linkId: string, path: string) => Promise<void>;
  stopWatching: (linkId: string) => Promise<void>;
  fetchStatus: () => Promise<void>;
  addEvent: (event: WatcherEvent) => void;
  clearEvents: () => void;
}

export const useWatcherStore = create<WatcherStore>((set) => ({
  watcherStatus: {},
  events: [],

  startWatching: async (linkId: string, path: string) => {
    const result = await commands.startWatching(linkId, path);
    if (result.status === "ok") {
      set((state) => ({
        watcherStatus: { ...state.watcherStatus, [linkId]: true },
      }));
    } else {
      console.error(`Failed to start watching ${linkId}:`, result.error);
    }
  },

  stopWatching: async (linkId: string) => {
    const result = await commands.stopWatching(linkId);
    if (result.status === "ok") {
      set((state) => ({
        watcherStatus: { ...state.watcherStatus, [linkId]: false },
      }));
    } else {
      console.error(`Failed to stop watching ${linkId}:`, result.error);
    }
  },

  fetchStatus: async () => {
    const result = await commands.getWatcherStatus();
    if (result.status === "ok") {
      set({ watcherStatus: result.data && typeof result.data === "object" ? result.data : {} });
    } else {
      console.error("Failed to fetch watcher status:", result.error);
      set({ watcherStatus: {} });
    }
  },

  addEvent: (event: WatcherEvent) => {
    set((state) => ({
      events: [event, ...state.events].slice(0, 100), // Keep last 100
    }));
  },

  clearEvents: () => set({ events: [] }),
}));