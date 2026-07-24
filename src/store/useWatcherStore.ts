import { create } from "zustand";
import { WatcherEvent } from "../types/watcher";
import { watcherApi } from "../services/tauriApi";

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
    try {
      await watcherApi.startWatching(linkId, path);
      set((state) => ({
        watcherStatus: { ...state.watcherStatus, [linkId]: true },
      }));
    } catch (error) {
      console.error(`Failed to start watching ${linkId}:`, error);
    }
  },

  stopWatching: async (linkId: string) => {
    try {
      await watcherApi.stopWatching(linkId);
      set((state) => ({
        watcherStatus: { ...state.watcherStatus, [linkId]: false },
      }));
    } catch (error) {
      console.error(`Failed to stop watching ${linkId}:`, error);
    }
  },

  fetchStatus: async () => {
    try {
      const status = await watcherApi.getWatcherStatus();
      set({ watcherStatus: status && typeof status === "object" ? status : {} });
    } catch (error) {
      console.error("Failed to fetch watcher status:", error);
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