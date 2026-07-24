import { create } from 'zustand';

interface TerminalState {
  isOpen: boolean;
  activeCommand: string | null;
  togglePanel: () => void;
  openWithCommand: (cmd: string) => void;
  closePanel: () => void;
}

export const useTerminalStore = create<TerminalState>((set) => ({
  isOpen: false,
  activeCommand: null,
  togglePanel: () => set((state) => ({ isOpen: !state.isOpen })),
  openWithCommand: (cmd) => set({ isOpen: true, activeCommand: cmd }),
  closePanel: () => set({ isOpen: false, activeCommand: null }),
}));
