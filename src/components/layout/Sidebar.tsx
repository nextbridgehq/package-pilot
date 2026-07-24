import React from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  BoardRegular,
  FolderRegular,
  BoxRegular,
  LinkRegular,
  EyeRegular,
  StethoscopeRegular,
  DocumentTextRegular,
  SettingsRegular,
  PowerRegular,
} from "@fluentui/react-icons";
import { Page } from "./AppLayout";

const useStyles = makeStyles({
  sidebar: {
    width: "240px",
    backgroundColor: tokens.colorNeutralBackground1,
    borderRight: `1px solid ${tokens.colorNeutralStroke1}`,
    display: "flex",
    flexDirection: "column",
    padding: "8px",
  },
  navList: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
  },
  navItem: {
    cursor: "pointer",
    padding: "10px 16px",
    borderRadius: "6px",
    display: "flex",
    alignItems: "center",
    gap: "12px",
    fontSize: "14px",
    color: tokens.colorNeutralForeground2,
    "&:hover": {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  navItemActive: {
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    fontWeight: "600",
  },
  logo: {
    padding: "16px",
    fontSize: "18px",
    fontWeight: "700",
    color: tokens.colorBrandForeground1,
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "8px",
  },
  exitItem: {
    marginTop: "auto",
    color: tokens.colorStatusDangerForeground1,
    "&:hover": {
      backgroundColor: tokens.colorStatusDangerBackground1,
    },
  },
});

interface SidebarProps {
  currentPage: Page;
  onPageChange: (page: Page) => void;
}

const navItems: { id: Page; label: string; icon: React.ReactElement }[] = [
  { id: "dashboard", label: "Dashboard", icon: <BoardRegular /> },
  { id: "projects", label: "Projects", icon: <FolderRegular /> },
  { id: "packages", label: "Packages", icon: <BoxRegular /> },
  { id: "links", label: "Link Manager", icon: <LinkRegular /> },
  { id: "watcher", label: "Watcher", icon: <EyeRegular /> },
  { id: "doctor", label: "Doctor", icon: <StethoscopeRegular /> },
  { id: "logs", label: "Logs", icon: <DocumentTextRegular /> },
  { id: "settings", label: "Settings", icon: <SettingsRegular /> },
];

export const Sidebar: React.FC<SidebarProps> = ({ currentPage, onPageChange }) => {
  const styles = useStyles();

  const handleExit = async () => {
    try {
      await invoke("quit_app");
    } catch (error) {
      console.error("Failed to close window:", error);
    }
  };

  return (
    <div className={styles.sidebar}>
      <div className={styles.logo}>
        <img src="/logo.png" alt="Package Pilot Logo" style={{ width: 32, height: 32 }} />
        Package Pilot
      </div>
      <div className={styles.navList}>
        {navItems.map((item) => (
          <div
            key={item.id}
            className={`${styles.navItem} ${currentPage === item.id ? styles.navItemActive : ""}`}
            onClick={() => onPageChange(item.id)}
          >
            {item.icon}
            <span>{item.label}</span>
          </div>
        ))}
      </div>
      <div
        className={`${styles.navItem} ${styles.exitItem}`}
        onClick={handleExit}
      >
        <PowerRegular />
        <span>Exit App</span>
      </div>
    </div>
  );
};