import { create } from "zustand";
import { AppConfig } from "../types/config";
import { configApi } from "../services/tauriApi";

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
    try {
      const config = await configApi.getConfig();
      set({ config, loading: false, theme: config.appearance.theme as any });
    } catch {
      set({ loading: false });
    }
  },

  saveConfig: async (config: AppConfig) => {
    await configApi.saveConfig(config);
    set({ config });
  },
}));