import { create } from 'zustand';

export interface TerminalSession {
  id: string;
  title: string;
  cwd: string;
}

interface TerminalState {
  isOpen: boolean;
  sessions: TerminalSession[];
  activeSessionId: string | null;
  splitSessionId: string | null;
  pendingCommand: string | null;
  /** Sessions whose backend shell exited on its own (not via closeSession). */
  exitedSessionIds: Set<string>;

  togglePanel: () => void;
  closePanel: () => void;
  openWithCommand: (cmd: string) => void;
  openWithSession: (session: TerminalSession) => void;
  openWithSessions: (sessions: TerminalSession[]) => void;
  closeSession: (id: string) => void;
  setActiveSession: (id: string) => void;
  setSplitSession: (id: string | null) => void;
  consumePendingCommand: () => string | null;
  markSessionExited: (id: string) => void;
}

const merge = (existing: TerminalSession[], incoming: TerminalSession[]) => {
  const byId = new Map(existing.map((s) => [s.id, s]));
  for (const s of incoming) byId.set(s.id, s);
  return Array.from(byId.values());
};

export const useTerminalStore = create<TerminalState>((set, get) => ({
  isOpen: false,
  sessions: [],
  activeSessionId: null,
  splitSessionId: null,
  pendingCommand: null,
  exitedSessionIds: new Set(),

  togglePanel: () => set((s) => ({ isOpen: !s.isOpen })),

  // Closing the panel hides the view only. Sessions and their PTYs survive
  // so a running dev server is still streaming when the panel reopens.
  closePanel: () => set({ isOpen: false }),

  openWithCommand: (cmd) => set({ isOpen: true, pendingCommand: cmd }),

  openWithSession: (session) =>
    set((s) => ({
      isOpen: true,
      sessions: merge(s.sessions, [session]),
      activeSessionId: session.id,
    })),

  openWithSessions: (sessions) =>
    set((s) =>
      sessions.length === 0
        ? { isOpen: true }
        : {
            isOpen: true,
            sessions: merge(s.sessions, sessions),
            activeSessionId: sessions[0].id,
            splitSessionId: null,
          },
    ),

  closeSession: (id) =>
    set((s) => {
      const index = s.sessions.findIndex((x) => x.id === id);
      const sessions = s.sessions.filter((x) => x.id !== id);
      let activeSessionId = s.activeSessionId;
      if (activeSessionId === id) {
        const neighbour = sessions[index] ?? sessions[index - 1] ?? null;
        activeSessionId = neighbour ? neighbour.id : null;
      }
      const exitedSessionIds = new Set(s.exitedSessionIds);
      exitedSessionIds.delete(id);
      return {
        sessions,
        activeSessionId,
        splitSessionId: s.splitSessionId === id ? null : s.splitSessionId,
        exitedSessionIds,
      };
    }),

  // Activating a session that is currently shown in the split pane collapses
  // the split, so the same session id never appears twice in `visible`.
  setActiveSession: (id) =>
    set((s) => ({
      activeSessionId: id,
      splitSessionId: s.splitSessionId === id ? null : s.splitSessionId,
    })),
  setSplitSession: (id) => set({ splitSessionId: id }),

  consumePendingCommand: () => {
    const cmd = get().pendingCommand;
    if (cmd !== null) set({ pendingCommand: null });
    return cmd;
  },

  markSessionExited: (id) =>
    set((s) => {
      const exitedSessionIds = new Set(s.exitedSessionIds);
      exitedSessionIds.add(id);
      return { exitedSessionIds };
    }),
}));
