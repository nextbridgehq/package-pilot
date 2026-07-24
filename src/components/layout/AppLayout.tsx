import React from "react";
import {
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { StatusBar } from "./StatusBar";
import { Dashboard } from "../../pages/Dashboard/Dashboard";
import { ProjectList } from "../../pages/Projects/ProjectList";
import { PackageList } from "../../pages/Packages/PackageList";
import { LinkManager } from "../../pages/LinkManager/LinkManager";
import { WatcherDashboard } from "../../pages/Watcher/WatcherDashboard";
import { Doctor } from "../../pages/Doctor/Doctor";
import { LogViewer } from "../../pages/Logs/LogViewer";
import { Settings } from "../../pages/Settings/Settings";
import { TerminalPanel } from '../terminal/TerminalPanel';
import { CommandPalette } from '../CommandPalette/CommandPalette';

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    overflow: "hidden",
  },
  body: {
    display: "flex",
    flex: 1,
    overflow: "hidden",
  },
  content: {
    flex: 1,
    overflow: "auto",
    padding: "20px",
    backgroundColor: tokens.colorNeutralBackground2,
  },
});

export type Page =
  | "dashboard"
  | "projects"
  | "packages"
  | "links"
  | "watcher"
  | "doctor"
  | "logs"
  | "settings";

export const AppLayout: React.FC = () => {
  const styles = useStyles();
  const [currentPage, setCurrentPage] = React.useState<Page>(() => {
    const hash = window.location.hash.replace("#", "") as Page;
    return hash || "dashboard";
  });

  React.useEffect(() => {
    const handlePopState = () => {
      const hash = window.location.hash.replace("#", "") as Page;
      setCurrentPage(hash || "dashboard");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = (page: Page) => {
    window.history.pushState(null, "", `#${page}`);
    setCurrentPage(page);
  };

  const renderPage = () => {
    switch (currentPage) {
      case "dashboard":
        return <Dashboard onNavigate={navigate} />;
      case "projects":
        return <ProjectList onNavigate={navigate} />;
      case "packages":
        return <PackageList onNavigate={navigate} />;
      case "links":
        return <LinkManager />;
      case "watcher":
        return <WatcherDashboard />;
      case "doctor":
        return <Doctor />;
      case "logs":
        return <LogViewer />;
      case "settings":
        return <Settings />;
      default:
        return <Dashboard onNavigate={navigate} />;
    }
  };

  return (
    <div className={styles.root}>
      <Header />
      <div className={styles.body}>
        <Sidebar currentPage={currentPage} onPageChange={navigate} />
        <div className={styles.content}>{renderPage()}</div>
      </div>
      <StatusBar />
      <TerminalPanel />
      <CommandPalette onNavigate={navigate as any} />
    </div>
  );
};
