import { create } from "zustand";
import { AppConfig } from "../types/config";
import { commands } from "../bindings";

interface SettingsStore {
  theme: "light" | "dark" | "system";
  config: AppConfig | null;
  loading: boolean;

  setTheme: (theme: "light" | "dark" | "system") => void;
  fetchConfig: () => Promise<void>;
  saveConfig: (config: AppConfig) => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  theme: "light",
  config: null,
  loading: false,

  setTheme: (theme) => set({ theme }),

  fetchConfig: async () => {
    set({ loading: true });
    const result = await commands.getConfig();
    if (result.status === "ok" && result.data) {
      set({ config: result.data, loading: false, theme: result.data.appearance?.theme as any });
    } else {
      set({ loading: false });
    }
  },

  saveConfig: async (config: AppConfig) => {
    await commands.saveConfig(config);
    set({ config });
  },
}));