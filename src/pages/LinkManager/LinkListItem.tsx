import React from "react";
import {
  makeStyles,
  tokens,
  Text,
  Badge,
  Button,
  Card,
  Spinner,
  mergeClasses,
  Toaster,
  useId,
  useToastController,
  Toast,
  ToastTitle,
} from "@fluentui/react-components";
import {
  DeleteRegular,
  EyeRegular,
  DismissRegular,
  FolderRegular,
  PlayCircleRegular,
  CodeRegular,
} from "@fluentui/react-icons";
import { StatusBadge } from "../../components/common/StatusBadge";
import { useSharedStyles } from "../../styles/useSharedStyles";
import { utilityApi, linkApi, ptyApi } from "../../services/tauriApi";
import { useWatcherStore } from "../../store/useWatcherStore";
import { Terminal, TerminalRef } from "../../components/common/Terminal";
import { LinkEntry, LinkStatus } from "../../types/link";
import { formatLinkMethod } from "../../utils/formatters";
import { confirm } from "@tauri-apps/plugin-dialog";

const useStyles = makeStyles({
  linkRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px",
    borderRadius: "8px",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    marginBottom: "8px",
  },
  linkCard: {
    marginBottom: "8px",
  },
  linkInfo: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  linkActions: {
    display: "flex",
    gap: "8px",
  },
});

interface LinkListItemProps {
  link: LinkEntry;
  running: boolean;
  onRemove: (id: string) => Promise<void>;
  onRunScript: (id: string, targetPath: string, sourcePackage: string) => void;
  onRefresh: () => void;
  terminalRef: (el: TerminalRef | null) => void;
}

export const LinkListItem: React.FC<LinkListItemProps> = ({
  link,
  running,
  onRemove,
  onRunScript,
  onRefresh,
  terminalRef,
}) => {
  const styles = useStyles();
  const shared = useSharedStyles();
  const [showTerminal, setShowTerminal] = React.useState(false);
  const [terminalCmd, setTerminalCmd] = React.useState<string | undefined>();

  const toasterId = useId("link-item-toaster");
  const { dispatchToast } = useToastController(toasterId);

  const onToggleWatch = async () => {
    try {
      if (link.watch_enabled) {
        ptyApi.write(link.id, "\x03");
        await linkApi.toggleWatch(link.id, false);
        await useWatcherStore.getState().stopWatching(link.id);
      } else {
        const cmd = await linkApi.getWatchCommand(link.source_path);
        if (cmd) {
          setTerminalCmd(cmd);
          setShowTerminal(true);
          await linkApi.toggleWatch(link.id, true);
        } else {
          await linkApi.toggleWatch(link.id, true);
          dispatchToast(
            <Toast><ToastTitle>No watch script found — file watcher enabled without auto-rebuild</ToastTitle></Toast>,
            { intent: "info" }
          );
        }
        await useWatcherStore.getState().startWatching(link.id, link.source_path);
      }
      onRefresh();
    } catch (err) {
      dispatchToast(
        <Toast><ToastTitle>Failed to toggle watch: {String(err)}</ToastTitle></Toast>,
        { intent: "error" }
      );
    }
  };

  return (
    <React.Fragment>
      <Toaster toasterId={toasterId} position="bottom-end" />
      <div className={mergeClasses(styles.linkRow, shared.card)} style={{ opacity: typeof link.status === "object" && "Error" in link.status ? 0.8 : 1 }}>
        <div className={styles.linkInfo}>
          <Text weight="semibold">
            {link.source_package} → {link.target_project}
          </Text>
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            {link.source_path} → {link.target_path}
          </Text>
          <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
            <StatusBadge status={link.status as LinkStatus} />
            <Badge appearance="outline">{formatLinkMethod(link.method)}</Badge>
            {link.watch_enabled && (
              <Badge color="informative" appearance="tint">
                Watching
              </Badge>
            )}
          </div>
        </div>
        <div className={styles.linkActions}>
          <Button
            appearance="subtle"
            icon={<CodeRegular />}
            onClick={() => setShowTerminal(prev => !prev)}
            title={showTerminal ? "Hide Terminal" : "Show Terminal"}
          />
          {link.has_cli && (
            <Button
              appearance="subtle"
              icon={running ? <Spinner size="tiny" /> : <PlayCircleRegular />}
              onClick={() => onRunScript(link.id, link.target_path, link.source_package)}
              title="Run Package Help in Sandbox"
            />
          )}
          <Button
            appearance="subtle"
            icon={<FolderRegular />}
            onClick={() => utilityApi.openInExplorer(link.target_path)}
            title="Open Target Project Folder"
          />
          <Button
            appearance="subtle"
            icon={link.watch_enabled ? <DismissRegular /> : <EyeRegular />}
            onClick={onToggleWatch}
            title={link.watch_enabled ? "Remove Watcher" : "Add Watcher"}
          />
          <Button
            appearance="subtle"
            icon={<DeleteRegular />}
            onClick={async () => {
              const confirmed = await confirm(`Are you sure you want to remove the link between ${link.source_package} and ${link.target_project}?`, {
                title: "Remove Link",
                kind: "warning",
              });
              if (confirmed) {
                onRemove(link.id);
              }
            }}
            title="Remove Link"
          />
        </div>
      </div>
      {showTerminal && (
        <Card
          style={{
            marginTop: "-8px",
            marginBottom: "8px",
            padding: "12px",
            backgroundColor: tokens.colorNeutralBackground3,
          }}
        >
          <Text
            weight="semibold"
            size={200}
            style={{
              color: tokens.colorNeutralForeground3,
              marginBottom: "8px",
              display: "block",
            }}
          >
            Interactive Terminal:
          </Text>
          <Terminal directory={link.target_path} sessionId={link.id} ref={terminalRef} initialCommand={terminalCmd} />
        </Card>
      )}
    </React.Fragment>
  );
};

