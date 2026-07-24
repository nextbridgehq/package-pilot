import React, { useEffect, useRef } from 'react';
import '@xterm/xterm/css/xterm.css';
import { ptyApi } from '../../services/tauriApi';
import { listen } from "@tauri-apps/api/event";
import { IPC_EVENTS } from "../../constants/ipc";
import { makeStyles, tokens } from '@fluentui/react-components';
import { getTerminalInstance } from '../../services/terminalService';

const useStyles = makeStyles({
  container: {
    height: '100%',
    width: '100%',
    backgroundColor: tokens.colorNeutralBackground1,
    padding: '8px',
    borderRadius: tokens.borderRadiusMedium,
    boxShadow: tokens.shadow4,
  }
});

interface Props {
  sessionId: string;
}

export const IntegratedTerminal: React.FC<Props> = ({ sessionId }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const styles = useStyles();

  useEffect(() => {
    if (!terminalRef.current) return;
    
    const instance = getTerminalInstance(sessionId);
    const { term, fitAddon } = instance;
    
    term.options.theme = { 
      background: tokens.colorNeutralBackground1 as string, 
      foreground: tokens.colorNeutralForeground1 as string 
    };
    
    if (!instance.mounted) {
      term.open(terminalRef.current);
      fitAddon.fit();
      instance.mounted = true;
      
      let unlisten: any;

      const setup = async () => {
        unlisten = await listen(IPC_EVENTS.PTY_OUTPUT, (event) => {
          const payload = event.payload as any;
          if (payload.session_id === sessionId) {
            term.write(payload.data);
          }
        });
        instance.unlisten = unlisten;
        
        if (instance.deleted) {
          if (unlisten) unlisten();
          return;
        }
        await ptyApi.spawn(sessionId, ".");
      };
      setup();

      term.onData((data) => {
        ptyApi.write(sessionId, data);
      });

      // Cleanup happens only when terminal is actually closed/destroyed
      // Not on simple unmount.
    } else {
      // Re-attach existing terminal to DOM if it was unmounted
      if (terminalRef.current.children.length === 0) {
        if (term.element) {
          terminalRef.current.appendChild(term.element);
        } else {
          term.open(terminalRef.current);
        }
        fitAddon.fit();
      }
    }

    return () => {
      // Intentionally do not destroy the terminal here.
      // This prevents React StrictMode double-mounting from killing the terminal.
    };
  }, [sessionId]);

  return <div ref={terminalRef} className={styles.container} />;
};
