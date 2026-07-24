import React, { useEffect } from "react";
import {
  makeStyles,
  tokens,
  Card,
  Title3,
  Text,
  Button,
  Badge,
  Switch,
} from "@fluentui/react-components";
import {
  EyeRegular,
  DismissRegular,
} from "@fluentui/react-icons";
import { IPC_EVENTS } from "../../constants/ipc";
import { LinkStatus } from "../../types/link";
import { formatLinkMethod } from "../../utils/formatters";
import { useLinkStore } from "../../store/useLinkStore";
import { useWatcherStore } from "../../store/useWatcherStore";
import { listen } from "@tauri-apps/api/event";
import { useSharedStyles } from "../../styles/useSharedStyles";
import { mergeClasses } from "@fluentui/react-components";

const useStyles = makeStyles({
  container: {
    display: "flex",
    flexDirection: "column",
    gap: "24px",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  watcherGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))",
    gap: "16px",
  },
  watcherCard: {
    padding: "20px",
  },
  watcherHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "12px",
  },
  eventsSection: {
    marginTop: "24px",
  },
  eventsList: {
    maxHeight: "400px",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  eventItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: "12px",
    padding: "8px 12px",
    borderRadius: "4px",
    backgroundColor: tokens.colorNeutralBackground1,
    fontSize: "12px",
    fontFamily: "monospace",
  },
  eventTime: {
    color: tokens.colorNeutralForeground3,
    minWidth: "85px",
    flexShrink: 0,
  },
  eventBadgeContainer: {
    minWidth: "190px",
    flexShrink: 0,
  },
  eventPath: {
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

export const WatcherDashboard: React.FC = () => {
  const styles = useStyles();
  const shared = useSharedStyles();
  const { activeLinks } = useLinkStore();
  const { watcherStatus, events, startWatching, stopWatching, addEvent, clearEvents, fetchStatus } =
    useWatcherStore();

  useEffect(() => {
    fetchStatus();

    // Listen for file change events from Tauri backend
    const unlisten = listen<{
      link_id: string;
      paths: string[];
      kind: string;
    }>(IPC_EVENTS.FILE_CHANGED, (event) => {
      addEvent({
        link_id: event.payload.link_id,
        paths: event.payload.paths,
        kind: event.payload.kind,
        timestamp: new Date().toISOString(),
      });
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [addEvent, fetchStatus]);

  const watchableLinks = activeLinks.filter((l) => l.watch_enabled);

  const toggleWatcher = async (linkId: string, path: string) => {
    try {
      if (watcherStatus[linkId]) {
        await stopWatching(linkId);
      } else {
        await startWatching(linkId, path);
      }
    } catch (e) {
      console.error("Failed to toggle watcher:", e);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <Title3>Package Watcher</Title3>
          {watchableLinks.length > 0 && (
            <Text
              weight="semibold"
              size={300}
              style={{
                backgroundColor: tokens.colorBrandBackground2,
                color: tokens.colorBrandForeground2,
                padding: "2px 10px",
                borderRadius: "12px",
              }}
            >
              {watchableLinks.length} {watchableLinks.length === 1 ? "watcher" : "watchers"}
            </Text>
          )}
        </div>
        <Button
          appearance="subtle"
          icon={<DismissRegular />}
          onClick={clearEvents}
        >
          Clear Events
        </Button>
      </div>

      {watchableLinks.length === 0 ? (
        <Card className={mergeClasses(shared.card, styles.emptyState)}>
          <EyeRegular style={{ fontSize: "48px", color: tokens.colorNeutralForeground3 }} />
          <Title3>No Watchers Configured</Title3>
          <Text>
            Create a link with "Watch for changes" enabled to see watchers here.
          </Text>
        </Card>
      ) : (
        <>
          <div className={styles.watcherGrid}>
            {watchableLinks.map((link) => (
              <Card key={link.id} className={mergeClasses(shared.card, styles.watcherCard)}>
                <div className={styles.watcherHeader}>
                  <div>
                    <Text weight="semibold" size={400}>
                      {link.source_package}
                    </Text>
                    <div style={{ color: tokens.colorNeutralForeground3, fontSize: "12px" }}>
                      {link.source_path}
                    </div>
                  </div>
                  <Switch
                    checked={!!watcherStatus[link.id]}
                    onChange={() => toggleWatcher(link.id, link.source_path)}
                    label={watcherStatus[link.id] ? "Active" : "Paused"}
                  />
                </div>

                <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                  <Badge color={watcherStatus[link.id] ? "success" : "informative"} appearance="tint">
                    {watcherStatus[link.id] ? "Watching" : "Paused"}
                  </Badge>
                  <Badge appearance="outline">{formatLinkMethod(link.method)}</Badge>
                </div>
              </Card>
            ))}
          </div>

          {/* Events Log */}
          <Card className={mergeClasses(shared.card, styles.eventsSection)}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0 0 16px 0" }}>
              <Title3 style={{ padding: 0 }}>Recent File Changes</Title3>
              {events.length > 0 && (
                <Text
                  weight="semibold"
                  size={300}
                  style={{
                    backgroundColor: tokens.colorBrandBackground2,
                    color: tokens.colorBrandForeground2,
                    padding: "2px 10px",
                    borderRadius: "12px",
                  }}
                >
                  {events.length}
                </Text>
              )}
            </div>

            {events.length === 0 ? (
              <Text style={{ color: tokens.colorNeutralForeground3 }}>
                No file changes detected yet. Modify files in watched directories to see events.
              </Text>
            ) : (
              <div className={styles.eventsList}>
                {events.map((event, index) => (
                  <div key={index} className={styles.eventItem}>
                    <div className={styles.eventTime}>
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </div>
                    <div className={styles.eventBadgeContainer}>
                      <Badge size="small" appearance="outline">
                        {event.kind}
                      </Badge>
                    </div>
                    <div className={styles.eventPath}>
                      {event.paths.join(", ")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
};
