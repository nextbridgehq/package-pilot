import React, { useEffect, useRef } from 'react';
import '@xterm/xterm/css/xterm.css';
import { commands } from '../../bindings';
import { listen } from "@tauri-apps/api/event";
import { IPC_EVENTS } from "../../constants/ipc";
import { makeStyles, Toaster, useId, useToastController, Toast, ToastTitle } from '@fluentui/react-components';
import { getTerminalInstance } from '../../services/terminalService';
import { fitIfVisible, syncPtySize, observePaneResize } from '../../services/terminalSizing';

const useStyles = makeStyles({
  container: {
    height: '100%',
    width: '100%',
    backgroundColor: 'transparent',
    padding: '0',
    boxSizing: 'border-box',
    overflow: 'hidden',
    position: 'relative',
    '& .xterm': {
      position: 'relative',
      height: '100%',
    }
  }
});

interface Props {
  sessionId: string;
  cwd?: string;
  /** Command to run once, only on a genuine fresh spawn (never on reattach). */
  initialCommand?: string;
  /** Called right after `initialCommand` has been written, so the caller can drop it. */
  onInitialCommandConsumed?: () => void;
}

export const IntegratedTerminal: React.FC<Props> = ({
  sessionId,
  cwd = ".",
  initialCommand,
  onInitialCommandConsumed,
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const styles = useStyles();
  const toasterId = useId('terminal-toaster');
  const { dispatchToast } = useToastController(toasterId);

  useEffect(() => {
    const host = terminalRef.current;
    if (!host) return;

    const instance = getTerminalInstance(sessionId);
    const { term, fitAddon } = instance;

    if (!instance.mounted) {
      term.open(host);
      instance.mounted = true;

      const setup = async () => {
        // `initialCommand` is a one-shot hand-off from TerminalPanel's
        // pendingInitialCommandsRef: whatever happens below (written,
        // reattach makes it moot, or setup fails outright), that entry must
        // be cleared here so it can't leak for this session's lifetime.
        try {
          const unlisten = await listen(IPC_EVENTS.PTY_OUTPUT, (event) => {
            const payload = event.payload as { session_id: string; data: string };
            if (payload.session_id === sessionId) term.write(payload.data);
          });
          instance.unlisten = unlisten;
          if (instance.deleted) { unlisten(); return; }

          // The backend may already have a live (or backgrounded) PTY for
          // this session - reattach and replay its history instead of
          // spawning a second shell and losing everything written so far.
          const historyRes = await commands.attachPty(sessionId);
          if (instance.deleted) return;
          const history = historyRes.status === "ok" ? historyRes.data : null;

          if (history != null) {
            term.write(history);
          } else {
            // Size the shell from the real geometry rather than a stale default.
            fitIfVisible(host, fitAddon);
            const res = await commands.spawnPty(sessionId, cwd, term.cols || 80, term.rows || 24);
            if (res.status === "error") {
              dispatchToast(
                <Toast><ToastTitle>Failed to spawn PTY: {String(res.error)}</ToastTitle></Toast>,
                { intent: "error" }
              );
              throw new Error(String(res.error));
            }
            syncPtySize(sessionId, term);
            if (initialCommand) {
              await commands.writePty(sessionId, initialCommand + "\r");
            }
          }
        } catch (err) {
          console.error("Failed to initialize integrated terminal:", err);
          term.write(`\r\nError initializing terminal: ${err}\r\n`);
        } finally {
          if (initialCommand) onInitialCommandConsumed?.();
        }
      };
      void setup();

      term.onData((data) => { void commands.writePty(sessionId, data); });
      // Route through syncPtySize rather than calling ptyApi.resize inline,
      // so this and every other resize path share one guard against
      // zero/unset dimensions and one place the rows/cols order can go wrong.
      term.onResize(() => syncPtySize(sessionId, term));
    } else if (host.children.length === 0) {
      // Re-attach a backgrounded terminal when its tab becomes active again.
      if (term.element) host.appendChild(term.element);
      else term.open(host);
      fitIfVisible(host, fitAddon);
      syncPtySize(sessionId, term);
    }

    const stopObserving = observePaneResize(host, () => {
      if (fitIfVisible(host, fitAddon)) syncPtySize(sessionId, term);
    });

    return () => {
      stopObserving();
      // Deliberately not disposing: the session outlives this view so a
      // running dev server survives a tab switch or a panel close.
    };
  }, [sessionId, cwd, dispatchToast, initialCommand, onInitialCommandConsumed]);

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />
      <div ref={terminalRef} className={styles.container} />
    </>
  );
};
