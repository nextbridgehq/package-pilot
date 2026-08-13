import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { StatusBar } from "./StatusBar";
import { Dashboard } from "../../pages/Dashboard/Dashboard";
import { AnalyticsDashboard } from "../../pages/Analytics/AnalyticsDashboard";
import { ProjectList } from "../../pages/Projects/ProjectList";
import { PackageList } from "../../pages/Packages/PackageList";
import { LinkManager } from "../../pages/LinkManager/LinkManager";
import { WatcherDashboard } from "../../pages/Watcher/WatcherDashboard";
import { RegistryManager } from "../../pages/Registry/RegistryManager";
import { Doctor } from "../../pages/Doctor/Doctor";
import { LogViewer } from "../../pages/Logs/LogViewer";
import { Settings } from "../../pages/Settings/Settings";
import { TopologyView } from "../../pages/Topology/TopologyView";
import { TerminalPanel } from '../terminal/TerminalPanel';
import { CommandPalette } from '../CommandPalette/CommandPalette';
import { UpdaterBanner } from '../updater/UpdaterBanner';
import { ErrorBoundary } from './ErrorBoundary';

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    overflow: "hidden",
    backgroundColor: tokens.colorNeutralBackground2,
    backgroundImage: `radial-gradient(at 0% 0%, ${tokens.colorBrandBackground2} 0, transparent 50%), radial-gradient(at 50% 0%, ${tokens.colorNeutralBackground3} 0, transparent 50%), radial-gradient(at 100% 0%, ${tokens.colorBrandBackground2Hover} 0, transparent 50%)`,
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
    backgroundColor: "transparent",
  },
});

export type Page =
  | "dashboard"
  | "analytics"
  | "projects"
  | "packages"
  | "links"
  | "topology"
  | "watcher"
  | "registry"
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
      case "analytics":
        return <AnalyticsDashboard />;
      case "projects":
        return <ProjectList onNavigate={navigate} />;
      case "packages":
        return <PackageList onNavigate={navigate} />;
      case "links":
        return <LinkManager />;
      case "topology":
        return <TopologyView />;
      case "watcher":
        return <WatcherDashboard />;
      case "registry":
        return <RegistryManager />;
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
      <UpdaterBanner />
      <div className={styles.body}>
        <Sidebar currentPage={currentPage} onPageChange={navigate} />
        <div className={styles.content}>
          <AnimatePresence mode="wait">
            <motion.div
              key={currentPage}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
            >
              {renderPage()}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
      {/* Own boundary: TerminalPanel is mounted unconditionally here, so a
          throw in it must not fall through to the app-wide boundary in
          App.tsx and blank the whole UI - only the panel's own area. */}
      <ErrorBoundary>
        <TerminalPanel />
      </ErrorBoundary>
      <StatusBar />
      <CommandPalette onNavigate={navigate as any} />
    </div>
  );
};
