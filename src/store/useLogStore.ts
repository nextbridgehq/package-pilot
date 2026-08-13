import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { LogEntry } from "../types/log";
import { commands } from "../bindings";

interface LogStore {
  logs: LogEntry[];
  loading: boolean;
  lastFetchTime: number;
  fetchLogs: () => Promise<void>;
  addLog: (log: Omit<LogEntry, "id" | "timestamp">) => void;
  clearLogs: () => Promise<void>;
  filterByLevel: (level: string) => LogEntry[];
}

export const useLogStore = create<LogStore>((set, get) => ({
  logs: [],
  loading: false,
  lastFetchTime: 0,

  fetchLogs: async () => {
    const { lastFetchTime, loading } = get();
    if (loading || Date.now() - lastFetchTime < 1000) return;
    set({ loading: true });
    try {
      const logs = await commands.getLogs();
      // Backend stores oldest-first (append-only Vec); the UI (and addLog's
      // prepend below) is newest-first, so reverse on the way in.
      set({ logs: [...logs].reverse(), loading: false, lastFetchTime: Date.now() });
    } catch (error) {
      console.error("fetchLogs error:", error);
      set({ loading: false });
    }
  },

  addLog: (log) => {
    const entry: LogEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...log,
    };
    set((state) => ({
      logs: [entry, ...state.logs].slice(0, 500),
    }));
  },

  clearLogs: async () => {
    try {
      await commands.clearLogs();
      set({ logs: [] });
    } catch (error) {
      console.error("clearLogs error:", error);
    }
  },

  filterByLevel: (level: string) => {
    return get().logs.filter((l) => l.level === level);
  },
}));

let cleanupPromise: Promise<() => void> | null = null;

export const initLogListener = () => {
  if (cleanupPromise) return cleanupPromise;
  
  cleanupPromise = listen<{ id: string; timestamp: string; level: string; message: string; source: string }>(
    "log-entry",
    (event) => {
      useLogStore.getState().addLog({
        level: event.payload.level as LogEntry["level"],
        message: event.payload.message,
        source: event.payload.source,
      });
    }
  );
  
  return cleanupPromise;
};
