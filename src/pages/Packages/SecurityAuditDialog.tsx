import React, { useState } from 'react';
import {
  Button,
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogContent,
  DialogActions,
  makeStyles,
} from '@fluentui/react-components';
import { ShieldRegular } from '@fluentui/react-icons';
import { useSecurityAudit } from '../../components/security/useSecurityAudit';
import { SecurityAuditResults } from '../../components/security/SecurityAuditResults';

interface Props {
  projectId: string;
}

const useStyles = makeStyles({
  surface: {
    maxWidth: '800px',
    width: '90vw',
  },
  content: {
    overflowY: 'auto',
    maxHeight: '65vh',
    paddingRight: '12px',
  },
});

export const SecurityAuditDialog: React.FC<Props> = ({ projectId }) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const styles = useStyles();
  const { loading, vulnerabilities, rawOutput, error, runAudit } = useSecurityAudit(projectId);

  return (
    <Dialog
      open={dialogOpen}
      onOpenChange={(_, data) => {
        // Re-run on every open rather than caching - a stale audit result
        // is worse than a fresh one, and audits are cheap enough to redo.
        // Guard against a second audit starting while one is still running
        // (rapid close-then-reopen) - without this, whichever run's
        // `finally { setLoading(false) }` fires last silently wins and the
        // spinner can clear while a stale audit is still in flight.
        if (data.open && !loading) void runAudit();
        setDialogOpen(data.open);
      }}
    >
      <DialogTrigger disableButtonEnhancement>
        <Button appearance="subtle" icon={<ShieldRegular />}>
          Run Security Audit
        </Button>
      </DialogTrigger>
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>Security Audit</DialogTitle>
          <DialogContent className={styles.content}>
            <SecurityAuditResults
              loading={loading}
              vulnerabilities={vulnerabilities}
              rawOutput={rawOutput}
              error={error}
            />
          </DialogContent>
          <DialogActions>
            <DialogTrigger disableButtonEnhancement>
              <Button appearance="secondary">Close</Button>
            </DialogTrigger>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};
