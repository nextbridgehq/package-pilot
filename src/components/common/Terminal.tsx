import React, { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import type { Terminal as XTerm } from "@xterm/xterm";
import { IPC_EVENTS } from "../../constants/ipc";
import { listen } from "@tauri-apps/api/event";
import { commands } from "../../bindings";
import { createConfiguredTerminal } from "../../services/terminalConfig";
import { fitIfVisible, syncPtySize, observePaneResize } from "../../services/terminalSizing";
import { Toaster, useId, useToastController, Toast, ToastTitle } from "@fluentui/react-components";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
  directory: string;
  sessionId?: string;
  initialCommand?: string;
}

export interface TerminalRef {
  writeCommand: (cmd: string) => void;
  /** Prints text into the view. Used by LinkManager for smoke-test output. */
  write: (data: string) => void;
}

export const Terminal = forwardRef<TerminalRef, TerminalProps>(({ directory, sessionId, initialCommand }, ref) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const toasterId = useId("common-terminal-toaster");
  const { dispatchToast } = useToastController(toasterId);

  useImperativeHandle(ref, () => ({
    writeCommand: (cmd: string) => {
      if (sessionIdRef.current) {
        void commands.writePty(sessionIdRef.current, cmd + "\r");
      }
    },
    write: (data: string) => {
      xtermRef.current?.write(data);
    },
  }));

  useEffect(() => {
    if (!wrapperRef.current) return;

    // The wrapper has a hardcoded dark background (#1e1e1e), so the terminal
    // must always use the dark theme (white text) to be visible, regardless of app theme.
    const mode = "dark";
    const { term, fitAddon } = createConfiguredTerminal(mode);
    term.open(wrapperRef.current);
    xtermRef.current = term;

    let currentSessionId: string | null = null;
    let unmounted = false;

    // Register onResize immediately before async ops
    term.onResize((size) => {
      if (currentSessionId) commands.resizePty(currentSessionId, size.rows, size.cols);
    });

    const initPty = async () => {
      try {
        const sid = sessionId || crypto.randomUUID();
        sessionIdRef.current = sid;
        currentSessionId = sid;
        
        console.log("Listening for PTY output on session:", sid);
        const unlisten = await listen<{ session_id: string; data: string }>(IPC_EVENTS.PTY_OUTPUT, (event) => {
          if (event.payload.session_id === currentSessionId) {
            term.write(event.payload.data);
            term.scrollToBottom();
          }
        });
        
        if (unmounted) {
            unlisten();
            return () => {};
        }

        const historyRes = await commands.attachPty(sid);
        const history = historyRes.status === "ok" ? historyRes.data : null;
        if (history != null) {
          console.log("Attached to existing PTY session:", sid);
          term.write(history);
          term.scrollToBottom();
        } else {
          console.log("Spawning PTY in directory:", directory);
          fitIfVisible(wrapperRef.current, fitAddon);
          const res = await commands.spawnPty(sid, directory, term.cols || 80, term.rows || 24);
          if (res.status === "error") {
            dispatchToast(
              <Toast><ToastTitle>Failed to spawn PTY: {String(res.error)}</ToastTitle></Toast>,
              { intent: "error" }
            );
            throw new Error(String(res.error));
          }
          syncPtySize(sid, term);
          console.log("PTY spawned with session ID:", sid);
          if (initialCommand) {
            commands.writePty(sid, initialCommand + "\r");
          }
        }

        term.onData((data) => {
          if (currentSessionId) commands.writePty(currentSessionId, data);
        });
        
        // Sync initial size in case fit() ran before spawn finished
        commands.resizePty(sid, term.rows, term.cols);

        const stopObserving = observePaneResize(wrapperRef.current!, () => {
          if (fitIfVisible(wrapperRef.current, fitAddon)) syncPtySize(sid, term);
        });

        return () => {
          stopObserving();
          unlisten();
        };
      } catch (err) {
        console.error("Failed to initialize PTY:", err);
        term.write(`\r\nError initializing terminal: ${err}\r\n`);
        return () => {};
      }
    };

    const unlistenPromise = initPty();

    return () => {
      unmounted = true;
      unlistenPromise.then(unlisten => unlisten && unlisten());
      if (currentSessionId && !sessionId) {
        commands.killPty(currentSessionId);
      }
      term.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directory, sessionId]);

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />
      <div style={{ width: "100%", height: "300px", minHeight: "150px", maxHeight: "500px", padding: "16px", overflow: "hidden", resize: "vertical", boxSizing: "border-box", borderRadius: "4px", backgroundColor: "#1e1e1e" }}>
        <div ref={wrapperRef} style={{ width: "100%", height: "100%" }} />
      </div>
    </>
  );
});

