import React, { useEffect } from "react";
import {
  makeStyles,
  tokens,
  Card,
  Text,
  Title3,
  Button,
  Badge,
} from "@fluentui/react-components";
import {
  LinkRegular,
  EyeRegular,
  FolderRegular,
  AddRegular,
  BoxRegular,
} from "@fluentui/react-icons";
import { useSharedStyles } from "../../styles/useSharedStyles";
import { formatLinkMethod } from "../../utils/formatters";
import { useLinkStore } from "../../store/useLinkStore";
import { useProjectStore } from "../../store/useProjectStore";
import { useWatcherStore } from "../../store/useWatcherStore";
import { Page } from "../../components/layout/AppLayout";
import { mergeClasses } from "@fluentui/react-components";

const useStyles = makeStyles({
  container: {
    display: "flex",
    flexDirection: "column",
    gap: "24px",
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "16px",
  },
  statCard: {
    padding: "20px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    borderTopWidth: "3px",
    borderTopStyle: "solid",
    borderTopColor: "transparent",
  },
  statCardClickable: {
    cursor: "pointer",
    transition: "background-color 0.2s, border-color 0.2s",
    "&:hover": {
      backgroundColor: tokens.colorNeutralBackground1Hover,
      borderTopColor: tokens.colorBrandStroke1,
      borderBottomColor: tokens.colorBrandStroke1,
      borderLeftColor: tokens.colorBrandStroke1,
      borderRightColor: tokens.colorBrandStroke1,
    },
  },
  statValue: {
    fontSize: "32px",
    fontWeight: "700",
    color: tokens.colorBrandForeground1,
  },
  statLabel: {
    fontSize: "14px",
    color: tokens.colorNeutralForeground3,
  },
  statIcon: {
    fontSize: "24px",
    color: tokens.colorBrandForeground2,
  },
  quickActions: {
    display: "flex",
    gap: "12px",
    flexWrap: "wrap",
  },
  recentActivity: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  activityItem: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "12px 16px",
    borderRadius: "8px",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  sectionTitle: {
    marginBottom: "8px",
  },
  activeLinksGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "12px",
  },
  linkCard: {
    padding: "16px",
  },
});

interface DashboardProps {
  onNavigate: (page: Page) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onNavigate }) => {
  const styles = useStyles();
  const shared = useSharedStyles();
  const { activeLinks, fetchLinks } = useLinkStore();
  const { projects, fetchProjects } = useProjectStore();
  const { watcherStatus, fetchStatus } = useWatcherStore();

  useEffect(() => {
    fetchLinks();
    fetchProjects();
    fetchStatus();
  }, [fetchLinks, fetchProjects, fetchStatus]);

  const activeWatchers = Object.values(watcherStatus ?? {}).filter(Boolean).length;

  return (
    <div className={styles.container}>
      <Title3>Dashboard</Title3>

      {/* Stats */}
      <div className={styles.statsGrid}>
        <Card 
          className={mergeClasses(shared.card, shared.cardInteractive, styles.statCard)}
          onClick={() => onNavigate("projects")}
        >
          <FolderRegular className={styles.statIcon} />
          <span className={styles.statValue}>{projects.length}</span>
          <span className={styles.statLabel}>Projects</span>
        </Card>
        <Card 
          className={mergeClasses(shared.card, shared.cardInteractive, styles.statCard)}
          onClick={() => onNavigate("packages")}
        >
          <BoxRegular className={styles.statIcon} />
          <span className={styles.statValue}>
            {projects.reduce((acc, p) => acc + p.packages.length, 0)}
          </span>
          <span className={styles.statLabel}>Packages</span>
        </Card>
        <Card 
          className={mergeClasses(shared.card, shared.cardInteractive, styles.statCard)}
          onClick={() => onNavigate("links")}
        >
          <LinkRegular className={styles.statIcon} />
          <span className={styles.statValue}>{activeLinks.length}</span>
          <span className={styles.statLabel}>Active Links</span>
        </Card>
        <Card 
          className={mergeClasses(shared.card, shared.cardInteractive, styles.statCard)}
          onClick={() => onNavigate("watcher")}
        >
          <EyeRegular className={styles.statIcon} />
          <span className={styles.statValue}>{activeWatchers}</span>
          <span className={styles.statLabel}>Active Watchers</span>
        </Card>
      </div>

      {/* Quick Actions */}
      <div>
        <Title3 className={styles.sectionTitle}>Quick Actions</Title3>
        <div className={styles.quickActions}>
          <Button
            appearance="primary"
            icon={<AddRegular />}
            onClick={() => {
              useProjectStore.getState().setAutoOpenAddDialog(true);
              onNavigate("projects");
            }}
          >
            Add Project
          </Button>
          <Button
            appearance="primary"
            icon={<LinkRegular />}
            onClick={() => {
              useLinkStore.getState().setPendingTab("create");
              onNavigate("links");
            }}
          >
            Create Link
          </Button>
        </div>
      </div>

      {/* Active Links */}
      {activeLinks.length > 0 && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Title3 className={styles.sectionTitle}>Active Links</Title3>
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
              {activeLinks.length}
            </Text>
          </div>
          <div className={styles.activeLinksGrid}>
            {activeLinks.slice(0, 6).map((link) => (
              <Card 
                key={link.id} 
                className={mergeClasses(shared.card, styles.linkCard, styles.statCardClickable)}
                onClick={() => onNavigate("links")}
              >
                <Text weight="semibold">{link.source_package}</Text>
                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                  → {link.target_project}
                </Text>
                <div style={{ marginTop: "8px", display: "flex", gap: "8px" }}>
                  <Badge color="success" appearance="tint">
                    {formatLinkMethod(link.method)}
                  </Badge>
                  {link.watch_enabled && (
                    <Badge color="informative" appearance="tint">
                      Watching
                    </Badge>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
