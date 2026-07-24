import { create } from "zustand";
import { Project } from "../types/project";
import { projectApi } from "../services/tauriApi";
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

const deletionTimers: Record<string, ReturnType<typeof setTimeout>> = {};

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
    try {
      const projects = await projectApi.listProjects();
      set({ projects: Array.isArray(projects) ? projects : [], loading: false, lastFetchTime: Date.now() });
    } catch (error) {
      set({ error: String(error), loading: false });
      console.error("fetchProjects error:", error);
    }
  },

  refreshProject: async (projectId: string, onlyCli: boolean) => {
    set({ loading: true, error: null });
    try {
      const updatedProject = await projectApi.refreshProject(projectId, onlyCli);
      set((state) => ({
        projects: state.projects.map((p) => p.id === projectId ? updatedProject : p),
        selectedProject: state.selectedProject?.id === projectId ? updatedProject : state.selectedProject,
        loading: false,
      }));
    } catch (error) {
      set({ error: String(error), loading: false });
      console.error("refreshProject error:", error);
    }
  },

  addProject: async (path: string, onlyCli: boolean = false) => {
    set({ loading: true, error: null });
    try {
      const project = await projectApi.addProject(path, onlyCli);
      set((state) => ({
        projects: [...state.projects, project],
        loading: false,
      }));
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },

  markForDeletion: (id: string) => {
    set((state) => {
      const pendingDeletions = new Set(state.pendingDeletions);
      pendingDeletions.add(id);
      return { pendingDeletions };
    });
    deletionTimers[id] = setTimeout(() => {
      get().removeProject(id);
      delete deletionTimers[id];
    }, 5000);
  },

  undoDeletion: (id: string) => {
    if (deletionTimers[id]) {
      clearTimeout(deletionTimers[id]);
      delete deletionTimers[id];
    }
    set((state) => {
      const pendingDeletions = new Set(state.pendingDeletions);
      pendingDeletions.delete(id);
      return { pendingDeletions };
    });
  },

  removeProject: async (id: string) => {
    try {
      await projectApi.removeProject(id);
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
    } catch (error) {
      set((state) => {
        const pendingDeletions = new Set(state.pendingDeletions);
        pendingDeletions.delete(id);
        return { error: String(error), pendingDeletions };
      });
    }
  },

  removePackage: async (projectId: string, packageName: string) => {
    try {
      await projectApi.removePackage(projectId, packageName);
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
    } catch (error) {
      set({ error: String(error) });
    }
  },

  selectProject: (project) => set({ selectedProject: project }),

  setAutoOpenAddDialog: (value: boolean) => set({ autoOpenAddDialog: value }),
}));
