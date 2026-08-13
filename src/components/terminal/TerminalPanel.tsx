import React, { useEffect, useRef } from 'react';
import { makeStyles, tokens, Button } from '@fluentui/react-components';
import { DismissRegular, SplitHorizontalRegular } from '@fluentui/react-icons';
import { listen } from '@tauri-apps/api/event';
import { useTerminalStore } from '../../store/useTerminalStore';
import { useProjectStore } from '../../store/useProjectStore';
import { IntegratedTerminal } from './IntegratedTerminal';
import { TerminalTabs } from './TerminalTabs';
import { useTerminalPanelHeight } from './useTerminalPanelHeight';
import { deleteTerminalInstance } from '../../services/terminalService';
import { commands } from '../../bindings';
import { IPC_EVENTS } from '../../constants/ipc';

const useStyles = makeStyles({
  panel: {
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    overflow: 'hidden',
    backgroundColor: tokens.colorNeutralBackground1,
    borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
  },
  grip: {
    height: '5px',
    cursor: 'ns-resize',
    backgroundColor: tokens.colorNeutralBackground3,
    flexShrink: 0,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    flexShrink: 0,
  },
  panes: {
    display: 'flex',
    flexDirection: 'row',
    flex: 1,
    minHeight: 0,
    gap: '2px',
    backgroundColor: tokens.colorNeutralStroke1,
  },
  pane: { flex: 1, minWidth: 0, backgroundColor: tokens.colorNeutralBackground1 },
});

export const TerminalPanel: React.FC = () => {
  const styles = useStyles();
  const isOpen = useTerminalStore((s) => s.isOpen);
  const sessions = useTerminalStore((s) => s.sessions);
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const splitSessionId = useTerminalStore((s) => s.splitSessionId);
  const setActiveSession = useTerminalStore((s) => s.setActiveSession);
  const closeSession = useTerminalStore((s) => s.closeSession);
  const setSplitSession = useTerminalStore((s) => s.setSplitSession);
  const closePanel = useTerminalStore((s) => s.closePanel);
  const togglePanel = useTerminalStore((s) => s.togglePanel);
  const exitedSessionIds = useTerminalStore((s) => s.exitedSessionIds);
  const markSessionExited = useTerminalStore((s) => s.markSessionExited);
  const { height, startDrag } = useTerminalPanelHeight();
  const pendingCommand = useTerminalStore((s) => s.pendingCommand);
  const consumePendingCommand = useTerminalStore((s) => s.consumePendingCommand);
  const openWithSession = useTerminalStore((s) => s.openWithSession);
  // A shell opened from the panel itself should start in the project the user
  // is working on, not in the app's own working directory.
  const selectedProject = useProjectStore((s) => s.selectedProject);

  // Commands queued for a session that doesn't exist yet: keyed by the new
  // session's id, consumed (and cleared) by that session's IntegratedTerminal
  // once its PTY is actually spawned. Kept out of the store - this is purely
  // local hand-off state for the mount that's about to happen.
  const pendingInitialCommandsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!pendingCommand) return;

    // openWithCommand may arrive before any session exists (lazy mount).
    const targetId = activeSessionId;
    const cmd = consumePendingCommand();
    if (!targetId) {
      const newId = crypto.randomUUID();
      // Don't write to the PTY here - it doesn't exist yet (spawn_pty hasn't
      // run). Hand the command to IntegratedTerminal instead, which writes
      // it only after its own spawn resolves.
      if (cmd) pendingInitialCommandsRef.current.set(newId, cmd);
      openWithSession({
        id: newId,
        title: selectedProject?.name ?? "shell",
        cwd: selectedProject?.path ?? ".",
      });
    } else if (cmd) {
      // The active session's PTY is already confirmed alive, so a direct
      // write has no ordering problem.
      void commands.writePty(targetId, cmd + "\r").catch(console.error);
    }
  }, [pendingCommand, activeSessionId, consumePendingCommand, openWithSession, selectedProject]);

  // Ctrl+` toggles. Esc is deliberately unbound - it is load-bearing inside
  // a terminal (readline, vim) and must reach the shell.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '`') {
        e.preventDefault();
        togglePanel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePanel]);

  // Global (not per-IntegratedTerminal) because a background tab that isn't
  // mounted right now must still be able to show it exited when reactivated.
  useEffect(() => {
    const unlistenPromise = listen<{ session_id: string }>(IPC_EVENTS.PTY_EXIT, (event) => {
      markSessionExited(event.payload.session_id);
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [markSessionExited]);

  const handleClose = (id: string) => {
    closeSession(id);
    deleteTerminalInstance(id);
  };

  const toggleSplit = () => {
    if (splitSessionId) {
      setSplitSession(null);
      return;
    }
    const partner = sessions.find((s) => s.id !== activeSessionId);
    if (partner) setSplitSession(partner.id);
  };

  if (!isOpen) return null;

  // Defensive dedup: activating the split pane's own session clears
  // splitSessionId in the store (see setActiveSession), but a Set guard here
  // keeps the same id from ever rendering twice even if another code path
  // reintroduces the collision later.
  const visibleIds = Array.from(
    new Set([activeSessionId, splitSessionId].filter((id): id is string => Boolean(id))),
  );
  const visible = visibleIds
    .map((id) => sessions.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s));

  return (
    <div className={styles.panel} style={{ height }}>
      <div className={styles.grip} onMouseDown={startDrag} role="separator" aria-label="Resize terminal" />
      <div className={styles.header}>
        <TerminalTabs
          sessions={sessions}
          activeSessionId={activeSessionId}
          exitedSessionIds={exitedSessionIds}
          onSelect={setActiveSession}
          onClose={handleClose}
        />
        <div style={{ display: 'flex', flexShrink: 0 }}>
          <Button
            appearance="subtle"
            size="small"
            icon={<SplitHorizontalRegular />}
            onClick={toggleSplit}
            disabled={sessions.length < 2}
            aria-label={splitSessionId ? 'Unsplit terminal' : 'Split terminal'}
          />
          <Button appearance="subtle" icon={<DismissRegular />} onClick={closePanel} size="small" aria-label="Close terminal panel" />
        </div>
      </div>
      <div className={styles.panes}>
        {/* eslint-disable-next-line react-hooks/refs */}
        {visible.map((session) => {
          const initialCommand = pendingInitialCommandsRef.current.get(session.id);
          const handleConsume = () => pendingInitialCommandsRef.current.delete(session.id);
          
          return (
            <div key={session.id} className={styles.pane}>
              <IntegratedTerminal
                sessionId={session.id}
                cwd={session.cwd}
                initialCommand={initialCommand}
                onInitialCommandConsumed={handleConsume}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
