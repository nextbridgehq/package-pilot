import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ptyApi } from './tauriApi';
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
    const term = new Terminal({
      fontFamily: 'Inter, monospace',
      fontSize: 13,
      scrollback: 10000,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    
    terminalRegistry[sessionId] = { term, fitAddon, mounted: false };
  }
  return terminalRegistry[sessionId];
};

export const deleteTerminalInstance = (sessionId: string) => {
  if (terminalRegistry[sessionId]) {
    terminalRegistry[sessionId].deleted = true;
    if (terminalRegistry[sessionId].unlisten) {
      terminalRegistry[sessionId].unlisten!();
    }
    terminalRegistry[sessionId].term.dispose();
    ptyApi.kill(sessionId);
    delete terminalRegistry[sessionId];
  }
};
