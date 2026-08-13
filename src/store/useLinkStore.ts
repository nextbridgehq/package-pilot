import { create } from "zustand";
import { LinkEntry, LinkMethod, LinkRequest } from "../types/link";
import { commands } from "../bindings";

// The Create Link form's in-progress input. AppLayout's page switch fully
// unmounts/remounts each page's component tree on navigation (see
// AppLayout.tsx's renderPage()), so anything kept in the form's own
// useState is lost the moment a user steps away (e.g. to Settings, to
// enable lifecycle scripts) and comes back. Keeping it here instead - the
// same pattern `pendingTab` below already uses - survives that unmount.
export interface LinkFormDraft {
  sourcePath: string;
  targetPath: string;
  method: LinkMethod;
  showAdvancedMethods: boolean;
  watchEnabled: boolean;
  buildFirst: boolean;
  installPeerDeps: boolean;
}

const defaultDraft: LinkFormDraft = {
  sourcePath: "",
  targetPath: "",
  method: "Symlink",
  showAdvancedMethods: false,
  watchEnabled: true,
  buildFirst: true,
  installPeerDeps: false,
};

interface LinkStore {
  activeLinks: LinkEntry[];
  pendingDeletions: Set<string>;
  loading: boolean;
  error: string | null;
  pendingTab: string | null;
  draft: LinkFormDraft;
  draftInitializedFromConfig: boolean;

  fetchLinks: () => Promise<void>;
  createLink: (request: LinkRequest) => Promise<void>;
  removeLink: (id: string) => Promise<void>;
  markForDeletion: (id: string) => void;
  undoDeletion: (id: string) => void;
  setPendingTab: (tab: string | null) => void;
  setDraft: (partial: Partial<LinkFormDraft>) => void;
  resetDraftAfterCreate: () => void;
  applyConfigDefaultsOnce: (buildFirst: boolean, installPeerDeps: boolean) => void;
}

const deletionTimers = new Map<string, ReturnType<typeof setTimeout>>();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    deletionTimers.forEach(clearTimeout);
    deletionTimers.clear();
  });
}

export const useLinkStore = create<LinkStore>((set, get) => ({
  activeLinks: [],
  pendingDeletions: new Set(),
  loading: false,
  error: null,
  pendingTab: null,
  draft: defaultDraft,
  draftInitializedFromConfig: false,

  fetchLinks: async () => {
    set({ loading: true, error: null });
    const result = await commands.listActiveLinks();
    if (result.status === "ok") {
      set({ activeLinks: Array.isArray(result.data) ? result.data : [], loading: false });
    } else {
      set({ error: String(result.error), loading: false });
    }
  },

  createLink: async (request: LinkRequest) => {
    set({ loading: true, error: null });
    const result = await commands.createLink(request);
    if (result.status === "ok") {
      set((state) => ({
        activeLinks: [...state.activeLinks, result.data],
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
      get().removeLink(id);
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

  removeLink: async (id: string) => {
    const result = await commands.removeLink(id);
    if (result.status === "ok") {
      set((state) => {
        const pendingDeletions = new Set(state.pendingDeletions);
        pendingDeletions.delete(id);
        return {
          activeLinks: state.activeLinks.filter((l) => l.id !== id),
          pendingDeletions,
          error: null,
        };
      });
    } else {
      set((state) => {
        const pendingDeletions = new Set(state.pendingDeletions);
        pendingDeletions.delete(id);
        return { error: String(result.error), pendingDeletions };
      });
    }
  },

  setPendingTab: (tab: string | null) => set({ pendingTab: tab }),

  setDraft: (partial) => set((state) => ({ draft: { ...state.draft, ...partial } })),

  resetDraftAfterCreate: () =>
    set((state) => ({ draft: { ...state.draft, sourcePath: "", targetPath: "" } })),

  // Config loads (or reloads after any Settings save) asynchronously and
  // produces a new object each time, so a plain `useEffect(() => ..., [config])`
  // would silently overwrite whatever the user has chosen in an in-progress
  // form every time they save any setting, not just the first time config
  // becomes available. Applying it once keeps the initial "seed from config"
  // behavior without that regression.
  applyConfigDefaultsOnce: (buildFirst, installPeerDeps) =>
    set((state) =>
      state.draftInitializedFromConfig
        ? state
        : {
            draft: { ...state.draft, buildFirst, installPeerDeps },
            draftInitializedFromConfig: true,
          }
    ),
}));