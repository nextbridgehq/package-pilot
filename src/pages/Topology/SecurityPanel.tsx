import React from 'react';
import {
  makeStyles,
  tokens,
  Title3,
  Button,
} from '@fluentui/react-components';
import { ShieldRegular } from '@fluentui/react-icons';
import { useProjectStore } from '../../store/useProjectStore';
import { useSecurityAudit } from '../../components/security/useSecurityAudit';
import { SecurityAuditResults } from '../../components/security/SecurityAuditResults';

const useStyles = makeStyles({
  container: {
    width: '320px',
    backgroundColor: tokens.colorNeutralBackground1,
    borderLeft: `1px solid ${tokens.colorNeutralStroke1}`,
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    boxSizing: 'border-box',
    overflowY: 'auto',
  },
  header: {
    padding: '16px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  content: {
    padding: '16px',
  },
});

export const SecurityPanel: React.FC = () => {
  const styles = useStyles();
  const { selectedProject } = useProjectStore();
  const { loading, vulnerabilities, rawOutput, error, runAudit } = useSecurityAudit(selectedProject?.id);

  if (!selectedProject) return null;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Title3>Security Audit</Title3>
        <Button
          icon={<ShieldRegular />}
          appearance="primary"
          onClick={runAudit}
          disabled={loading}
        >
          Run Security Audit
        </Button>
      </div>
      <div className={styles.content}>
        <SecurityAuditResults
          loading={loading}
          vulnerabilities={vulnerabilities}
          rawOutput={rawOutput}
          error={error}
        />
      </div>
    </div>
  );
};
