import React, { useEffect, useRef } from "react";
import {
  makeStyles,
  tokens,
  Card,
  Title3,
  Text,
  Button,
  Badge,
  mergeClasses,
} from "@fluentui/react-components";
import { DeleteRegular, DocumentTextRegular } from "@fluentui/react-icons";
import { useLogStore } from "../../store/useLogStore";
import { LogEntry } from "../../types/log";
import { useSharedStyles } from "../../styles/useSharedStyles";
import { useVirtualizer } from "@tanstack/react-virtual";

const useStyles = makeStyles({
  container: {
    display: "flex",
    flexDirection: "column",
    gap: "24px",
    height: "100%",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  listContainer: {
    flex: 1,
    overflow: "auto",
  },
  list: {
    fontFamily: "monospace",
    fontSize: "12px",
    position: "relative",
    width: "100%",
  },
  entry: {
    display: "flex",
    gap: "10px",
    alignItems: "flex-start",
    padding: "6px 10px",
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    boxSizing: "border-box",
  },
  timestamp: {
    color: tokens.colorNeutralForeground3,
    minWidth: "85px",
    flexShrink: 0,
  },
  badgeContainer: {
    minWidth: "190px",
    flexShrink: 0,
    display: "flex",
    gap: "8px",
    alignItems: "center",
  },
  source: {
    color: tokens.colorNeutralForeground3,
  },
  message: {
    flex: 1,
    wordBreak: "break-all",
    whiteSpace: "normal",
  },
  emptyState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "60px",
    gap: "16px",
  },
});

const levelColor: Record<LogEntry["level"], "success" | "warning" | "danger" | "informative"> = {
  info: "informative",
  success: "success",
  warning: "warning",
  error: "danger",
};

export const LogViewer: React.FC = () => {
  const styles = useStyles();
  const shared = useSharedStyles();
  const { logs, clearLogs, fetchLogs } = useLogStore();
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: logs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
  });

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Title3>Logs</Title3>
        <Button icon={<DeleteRegular />} onClick={clearLogs} disabled={logs.length === 0}>
          Clear
        </Button>
      </div>

      {logs.length === 0 ? (
        <Card className={mergeClasses(shared.card, styles.emptyState)}>
          <DocumentTextRegular style={{ fontSize: "48px", color: tokens.colorNeutralForeground3 }} />
          <Title3>No Logs Yet</Title3>
          <Text align="center">
            Activity from linking, building, and watching packages will appear here.
          </Text>
        </Card>
      ) : (
        <Card className={mergeClasses(shared.card, styles.listContainer)} style={{ padding: 0 }}>
          <div ref={parentRef} style={{ height: "100%", overflow: "auto", width: "100%" }}>
            <div
              className={styles.list}
              style={{ height: `${virtualizer.getTotalSize()}px` }}
            >
              {virtualizer.getVirtualItems().map((virtualItem) => {
                const entry = logs[virtualItem.index];
                return (
                  <div
                    key={virtualItem.key}
                    className={styles.entry}
                    style={{
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                  >
                    <div className={styles.timestamp}>
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </div>
                    <div className={styles.badgeContainer}>
                      <Badge size="small" color={levelColor[entry.level]}>
                        {entry.level}
                      </Badge>
                      <Text className={styles.source}>[{entry.source}]</Text>
                    </div>
                    <div className={styles.message}>
                      {entry.message}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};
