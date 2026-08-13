import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { createConfiguredTerminal, resolveTerminalMode } from './terminalConfig';
import { commands } from '../bindings';
import { useSettingsStore } from '../store/useSettingsStore';

interface TerminalInstance {
  term: Terminal;
  fitAddon: FitAddon;
  mounted: boolean;
  unlisten?: () => void;
  deleted?: boolean;
}

const terminalRegistry: Record<string, TerminalInstance> = {};

export const getTerminalInstance = (sessionId: string) => {
  if (!terminalRegistry[sessionId]) {
    // Only newly-created instances pick up the current theme; already-open
    // terminals are not retroactively re-themed (live theme-switching is
    // out of scope here).
    const mode = resolveTerminalMode(useSettingsStore.getState().theme);
    const { term, fitAddon } = createConfiguredTerminal(mode);
    terminalRegistry[sessionId] = { term, fitAddon, mounted: false };
  }
  return terminalRegistry[sessionId];
};

export const deleteTerminalInstance = (sessionId: string) => {
  const instance = terminalRegistry[sessionId];
  if (instance) {
    instance.deleted = true;
    if (instance.unlisten) instance.unlisten();
    instance.term.dispose();
    delete terminalRegistry[sessionId];
  }
  // Kill the backend PTY unconditionally - a background tab that was opened
  // but never activated never gets a registry entry above, but its PTY
  // still needs to die when the tab is closed.
  commands.killPty(sessionId);
};
