import React, { useEffect, useState } from 'react';
import { makeStyles, tokens, Button, mergeClasses } from '@fluentui/react-components';
import { DismissRegular } from '@fluentui/react-icons';
import { useTerminalStore } from '../../store/useTerminalStore';
import { IntegratedTerminal } from './IntegratedTerminal';
import { ptyApi } from '../../services/tauriApi';

const useStyles = makeStyles({
  panel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '300px',
    backgroundColor: tokens.colorNeutralBackground1,
    borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
    boxShadow: tokens.shadow8,
    display: 'flex',
    flexDirection: 'column',
    zIndex: 1000,
    transition: 'transform 0.3s ease-out',
    transform: 'translateY(100%)',
  },
  panelOpen: {
    transform: 'translateY(0)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '4px 12px',
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
  },
  content: {
    flex: 1,
    overflow: 'hidden',
  }
});

export const TerminalPanel: React.FC = () => {
  const styles = useStyles();
  const { isOpen, activeCommand, closePanel } = useTerminalStore();
  const [sessionId] = useState<string>(() => crypto.randomUUID());

  useEffect(() => {
    if (activeCommand && sessionId) {
      ptyApi.write(sessionId, activeCommand + "\r");
    }
  }, [activeCommand, sessionId]);

  useEffect(() => {
    return () => {
      ptyApi.kill(sessionId);
    };
  }, [sessionId]);

  return (
    <div className={mergeClasses(styles.panel, isOpen && styles.panelOpen)}>
      <div className={styles.header}>
        <span style={{ fontWeight: 600, fontSize: '12px' }}>Terminal</span>
        <Button appearance="subtle" icon={<DismissRegular />} onClick={closePanel} size="small" />
      </div>
      <div className={styles.content}>
        <IntegratedTerminal sessionId={sessionId} />
      </div>
    </div>
  );
};

