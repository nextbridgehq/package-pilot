import React from "react";
import { makeStyles, tokens, Badge } from "@fluentui/react-components";
import { useLinkStore } from "../../store/useLinkStore";
import { useWatcherStore } from "../../store/useWatcherStore";

const useStyles = makeStyles({
  statusBar: {
    height: "28px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 16px",
    backgroundColor: tokens.colorNeutralBackground1,
    borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
  },
  left: {
    display: "flex",
    gap: "16px",
    alignItems: "center",
  },
  right: {
    display: "flex",
    gap: "16px",
    alignItems: "center",
  },
  indicator: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
  },
});

export const StatusBar: React.FC = () => {
  const styles = useStyles();
  const activeLinks = useLinkStore((state) => state.activeLinks);
  const watcherStatus = useWatcherStore((state) => state.watcherStatus);
  const activeWatchers = Object.values(watcherStatus ?? {}).filter(Boolean).length;

  return (
    <div className={styles.statusBar}>
      <div className={styles.left}>
        <span className={styles.indicator}>
          <Badge size="tiny" color="success" />
          Active Links: {activeLinks.length}
        </span>
        <span className={styles.indicator}>
          <Badge size="tiny" color="informative" />
          Watchers: {activeWatchers}
        </span>
      </div>
      <div className={styles.right}>
        <span>Package Pilot v1.0.0</span>
      </div>
    </div>
  );
};