import { create } from "zustand";
import { Project } from "../types/project";
import { commands } from "../bindings";
import { useLinkStore } from "./useLinkStore";
import { useWatcherStore } from "./useWatcherStore";

interface ProjectStore {
  projects: Project[];
  pendingDeletions: Set<string>;
  selectedProject: Project | null;
  loading: boolean;
  error: string | null;
  autoOpenAddDialog: boolean;
  lastFetchTime: number;

  fetchProjects: () => Promise<void>;
  refreshProject: (projectId: string, onlyCli: boolean) => Promise<void>;
  addProject: (path: string, onlyCli?: boolean) => Promise<void>;
  removeProject: (id: string) => Promise<void>;
  markForDeletion: (id: string) => void;
  undoDeletion: (id: string) => void;
  removePackage: (projectId: string, packageName: string) => Promise<void>;
  selectProject: (project: Project | null) => void;
  setAutoOpenAddDialog: (value: boolean) => void;
}

const deletionTimers = new Map<string, ReturnType<typeof setTimeout>>();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    deletionTimers.forEach(clearTimeout);
    deletionTimers.clear();
  });
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  pendingDeletions: new Set(),
  selectedProject: null,
  loading: false,
  error: null,
  autoOpenAddDialog: false,
  lastFetchTime: 0,

  fetchProjects: async () => {
    const { lastFetchTime, loading } = get();
    if (loading || Date.now() - lastFetchTime < 1000) return;

    set({ loading: true, error: null });
    const result = await commands.listProjects();
    if (result.status === "ok") {
      set({ projects: Array.isArray(result.data) ? result.data : [], loading: false, lastFetchTime: Date.now() });
    } else {
      set({ error: String(result.error), loading: false });
      console.error("fetchProjects error:", result.error);
    }
  },

  refreshProject: async (projectId: string, onlyCli: boolean) => {
    set({ loading: true, error: null });
    const result = await commands.refreshProject(projectId, onlyCli);
    if (result.status === "ok") {
      const updatedProject = result.data;
      set((state) => ({
        projects: state.projects.map((p) => p.id === projectId ? updatedProject : p),
        selectedProject: state.selectedProject?.id === projectId ? updatedProject : state.selectedProject,
        loading: false,
      }));
    } else {
      set({ error: String(result.error), loading: false });
      console.error("refreshProject error:", result.error);
    }
  },

  addProject: async (path: string, onlyCli: boolean = false) => {
    set({ loading: true, error: null });
    const result = await commands.addProject(path, onlyCli);
    if (result.status === "ok") {
      set((state) => ({
        projects: [...state.projects, result.data],
        loading: false,
      }));
    } else {
      set({ error: String(result.error), loading: false });
    }
  },

  markForDeletion: (id: string) => {
    set((state) => {
      const pendingDeletions = new Set(state.pendingDeletions);
      pendingDeletions.add(id);
      return { pendingDeletions };
    });
    deletionTimers.set(id, setTimeout(() => {
      get().removeProject(id);
      deletionTimers.delete(id);
    }, 5000));
  },

  undoDeletion: (id: string) => {
    const timer = deletionTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      deletionTimers.delete(id);
    }
    set((state) => {
      const pendingDeletions = new Set(state.pendingDeletions);
      pendingDeletions.delete(id);
      return { pendingDeletions };
    });
  },

  removeProject: async (id: string) => {
    const result = await commands.removeProject(id);
    if (result.status === "ok") {
      set((state) => {
        const pendingDeletions = new Set(state.pendingDeletions);
        pendingDeletions.delete(id);
        return {
          projects: state.projects.filter((p) => p.id !== id),
          pendingDeletions,
          selectedProject:
            state.selectedProject?.id === id ? null : state.selectedProject,
          error: null,
        };
      });
      // Removing a project also removes its links and stops their watchers
      // on the backend - refresh both stores so the UI reflects that
      // immediately instead of showing stale entries until next navigation.
      useLinkStore.getState().fetchLinks();
      useWatcherStore.getState().fetchStatus();
    } else {
      set((state) => {
        const pendingDeletions = new Set(state.pendingDeletions);
        pendingDeletions.delete(id);
        return { error: String(result.error), pendingDeletions };
      });
    }
  },

  removePackage: async (projectId: string, packageName: string) => {
    const result = await commands.removePackage(projectId, packageName);
    if (result.status === "ok") {
      set((state) => ({
        projects: state.projects.map((p) => {
          if (p.id === projectId) {
            return {
              ...p,
              packages: p.packages.filter((pkg) => pkg.name !== packageName),
            };
          }
          return p;
        }),
        error: null,
      }));
      // Removing a package also removes its links and stops their watchers
      // on the backend - refresh both stores so the UI reflects that
      // immediately instead of showing stale entries until next navigation.
      useLinkStore.getState().fetchLinks();
      useWatcherStore.getState().fetchStatus();
    } else {
      set({ error: String(result.error) });
    }
  },

  selectProject: (project) => set({ selectedProject: project }),

  setAutoOpenAddDialog: (value: boolean) => set({ autoOpenAddDialog: value }),
}));
