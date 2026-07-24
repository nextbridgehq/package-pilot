import React, { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { IPC_EVENTS } from "../../constants/ipc";
import { FitAddon } from "@xterm/addon-fit";
import { listen } from "@tauri-apps/api/event";
import { ptyApi } from "../../services/tauriApi";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
  directory: string;
  sessionId?: string;
  initialCommand?: string;
}

export interface TerminalRef {
  writeCommand: (cmd: string) => void;
}

export const Terminal = forwardRef<TerminalRef, TerminalProps>(({ directory, sessionId, initialCommand }, ref) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  useImperativeHandle(ref, () => ({
    writeCommand: (cmd: string) => {
      if (sessionIdRef.current) {
        ptyApi.write(sessionIdRef.current, cmd + "\r");
      }
    }
  }));

  useEffect(() => {
    if (!wrapperRef.current) return;

    const term = new XTerm({
      theme: {
        background: '#1e1e1e',
        foreground: '#cccccc',
        cursor: '#ffffff',
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
      fontSize: 13,
      cursorBlink: true,
      scrollback: 10000,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(wrapperRef.current);
    xtermRef.current = term;

    let currentSessionId: string | null = null;
    let unmounted = false;

    // Register onResize immediately before async ops
    term.onResize((size) => {
      if (currentSessionId) ptyApi.resize(currentSessionId, size.rows, size.cols);
    });

    // Defer fit to ensure DOM is fully painted
    const fitTimeout = setTimeout(() => {
      if (unmounted) return;
      try {
        fitAddon.fit();
        // Also manually sync size just in case onResize didn't fire (if default size happened to match fit)
        if (currentSessionId) {
          ptyApi.resize(currentSessionId, term.rows, term.cols);
        }
      } catch (e) {
        console.warn("xterm fitAddon error:", e);
      }
    }, 100);

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

        const history = await ptyApi.attach(sid);
        if (history !== null) {
          console.log("Attached to existing PTY session:", sid);
          term.write(history);
          term.scrollToBottom();
        } else {
          console.log("Spawning PTY in directory:", directory);
          await ptyApi.spawn(sid, directory);
          console.log("PTY spawned with session ID:", sid);
          if (initialCommand) {
            ptyApi.write(sid, initialCommand + "\r");
          }
        }

        term.onData((data) => {
          if (currentSessionId) ptyApi.write(currentSessionId, data);
        });
        
        // Sync initial size in case fit() ran before spawn finished
        ptyApi.resize(sid, term.rows, term.cols);

        const resizeObserver = new ResizeObserver(() => {
          try {
            fitAddon.fit();
          } catch { /* ignore resize errors */ }
        });
        if (wrapperRef.current) {
          resizeObserver.observe(wrapperRef.current);
        }

        return () => {
          resizeObserver.disconnect();
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
      clearTimeout(fitTimeout);
      unlistenPromise.then(unlisten => unlisten && unlisten());
      if (currentSessionId && !sessionId) {
        ptyApi.kill(currentSessionId);
      }
      term.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directory, sessionId]);

  return (
    <div style={{ width: "100%", height: "300px", minHeight: "150px", maxHeight: "500px", padding: "16px", overflow: "hidden", resize: "vertical", boxSizing: "border-box", borderRadius: "4px", backgroundColor: "#1e1e1e" }}>
      <div ref={wrapperRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
});

