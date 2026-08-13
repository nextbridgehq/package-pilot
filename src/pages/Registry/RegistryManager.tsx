import React, { useState } from "react";
import {
  makeStyles,
  tokens,
  Card,
  Title3,
  Text,
  Button,
  Input,
  Badge,
  Spinner,
  mergeClasses,
} from "@fluentui/react-components";
import {
  DatabaseRegular,
  PlayRegular,
  StopRegular,
  ArrowUploadRegular,
  OpenRegular,
} from "@fluentui/react-icons";
import { listen } from "@tauri-apps/api/event";
import { commands } from "../../bindings";
import { useSharedStyles } from "../../styles/useSharedStyles";
import { useSettingsStore } from "../../store/useSettingsStore";
import { FilePickerButton } from "../../components/common/FilePickerButton";
import { useLogStore } from "../../store/useLogStore";
import { IPC_EVENTS } from "../../constants/ipc";

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
  statusCard: {
    padding: "24px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statusInfo: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  configCard: {
    padding: "24px",
  },
  configForm: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  publishCard: {
    padding: "24px",
  },
  publishForm: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  formRow: {
    display: "flex",
    gap: "12px",
    alignItems: "center",
  },
  packageList: {
    marginTop: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  packageItem: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px",
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: "8px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
});

export const RegistryManager: React.FC = () => {
  const styles = useStyles();
  const shared = useSharedStyles();
  const { addLog } = useLogStore();
  const { config, saveConfig } = useSettingsStore();
  
  const [registryRunning, setRegistryRunning] = useState(false);
  const [registryPort, setRegistryPort] = useState("4873");
  const [loading, setLoading] = useState(false);
  const [publishPath, setPublishPath] = useState("");
  const [publishLoading, setPublishLoading] = useState(false);
  const [publishedPackages, setPublishedPackages] = useState([]);

  React.useEffect(() => {
    if (config?.registry?.port) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRegistryPort(config.registry.port.toString());
    }
  }, [config]);
  const refreshPackages = React.useCallback(async () => {
    try {
      const res = await commands.listRegistryPackages(
        `http://localhost:${registryPort}`
      );
      if (res.status === "ok") {
        setPublishedPackages(res.data as never[]);
      } else {
        console.error("Failed to fetch packages:", res.error);
      }
    } catch (error) {
      console.error("Failed to fetch packages:", error);
    }
  }, [registryPort]);

  React.useEffect(() => {
    commands.getRegistryStatus().then((res) => {
      if (res.status !== "ok") return;
      const status = res.data;
      setRegistryRunning(status.running);
      if (status.running) {
        refreshPackages();
      }
    }).catch(console.error);
  }, [registryPort, refreshPackages]);

  // The registry can go down in the background (e.g. verdaccio crashes
  // repeatedly and the backend's auto-restart gives up after its retry
  // budget) with no direct call site on this page to catch it - without
  // this, the UI keeps showing "Running" forever after that happens.
  React.useEffect(() => {
    const unlistenPromise = listen<{ running: boolean; pid: number | null }>(
      IPC_EVENTS.REGISTRY_STATUS_CHANGED,
      (event) => {
        setRegistryRunning(event.payload.running);
        if (!event.payload.running) {
          setPublishedPackages([]);
        }
      }
    );
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const handleStartRegistry = async () => {
    setLoading(true);
    try {
      const parsedPort = parseInt(registryPort);
      if (isNaN(parsedPort) || parsedPort < 1024 || parsedPort > 65535) {
        throw new Error("Port must be a number between 1024 and 65535");
      }
      // Keep the persisted config in sync with whatever port this page
      // actually starts the registry on - otherwise a port typed here only
      // lives in this component's local state and the next launch (or
      // auto_start) silently reverts to whatever Settings last saved.
      if (config && config.registry.port !== parsedPort) {
        await saveConfig({
          ...config,
          registry: { ...config.registry, port: parsedPort },
        });
      }
      const res = await commands.startRegistry(parsedPort);
      if (res.status !== "ok") throw res.error;
      setRegistryRunning(true);
      addLog({
        level: "success",
        message: `Registry started on port ${registryPort}`,
        source: "Registry",
      });
    } catch (error) {
      addLog({
        level: "error",
        message: `Failed to start registry: ${error}`,
        source: "Registry",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleStopRegistry = async () => {
    setLoading(true);
    try {
      const res = await commands.stopRegistry();
      if (res.status !== "ok") throw res.error;
      setRegistryRunning(false);
      addLog({
        level: "info",
        message: "Registry stopped",
        source: "Registry",
      });
    } catch (error) {
      addLog({
        level: "error",
        message: `Failed to stop registry: ${error}`,
        source: "Registry",
      });
    } finally {
      setLoading(false);
    }
  };

  const handlePublish = async () => {
    if (!publishPath) return;
    setPublishLoading(true);
    try {
      const res = await commands.publishToRegistry(
        publishPath,
        `http://localhost:${registryPort}`,
        null
      );
      if (res.status !== "ok") throw res.error;
      addLog({
        level: "success",
        message: `Published package from ${publishPath}`,
        source: "Registry",
      });
      setPublishPath("");
      // Refresh published packages
      await refreshPackages();
    } catch (error) {
      addLog({
        level: "error",
        message: `Publish failed: ${error}`,
        source: "Registry",
      });
    } finally {
      setPublishLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <Title3>Local Registry (Verdaccio)</Title3>
          {publishedPackages.length > 0 && (
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
              {publishedPackages.length} {publishedPackages.length === 1 ? "package" : "packages"}
            </Text>
          )}
        </div>
      </div>

      {/* Registry Status */}
      <Card className={mergeClasses(shared.card, styles.statusCard)}>
        <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
          <DatabaseRegular style={{ fontSize: "32px", color: tokens.colorBrandForeground1 }} />
          <div className={styles.statusInfo}>
            <Text weight="semibold" size={400}>
              Local Registry
            </Text>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              {registryRunning
                ? `Running on http://localhost:${registryPort}`
                : "Not running"}
            </Text>
          </div>
        </div>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <Badge color={registryRunning ? "success" : "informative"} appearance="tint" size="large">
            {registryRunning ? "Running" : "Stopped"}
          </Badge>
          {!registryRunning ? (
            <Button
              appearance="primary"
              icon={loading ? <Spinner size="tiny" /> : <PlayRegular />}
              onClick={handleStartRegistry}
              disabled={loading}
            >
              Start Registry
            </Button>
          ) : (
            <>
              <Button
                appearance="subtle"
                icon={<OpenRegular />}
                onClick={() => commands.openUrl(`http://localhost:${registryPort}`)}
              >
                Open UI
              </Button>
              <Button
                appearance="secondary"
                icon={loading ? <Spinner size="tiny" /> : <StopRegular />}
                onClick={handleStopRegistry}
                disabled={loading}
              >
                Stop
              </Button>
            </>
          )}
        </div>
      </Card>

      {/* Configuration */}
      <Card className={mergeClasses(shared.card, styles.configCard)}>
        <Title3>Configuration</Title3>
        <div className={styles.configForm} style={{ marginTop: "16px" }}>
          <div className={styles.formRow}>
            <Text weight="semibold" style={{ width: "100px" }}>Port:</Text>
            <Input
              value={registryPort}
              onChange={(_, data) => setRegistryPort(data.value)}
              type="number"
              style={{ width: "120px" }}
              disabled={registryRunning}
            />
          </div>
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            The registry URL will be: http://localhost:{registryPort}
          </Text>
        </div>
      </Card>

      {/* Publish Package */}
      <Card className={mergeClasses(shared.card, styles.publishCard)}>
        <Title3>Publish Package</Title3>
        <Text size={200} style={{ color: tokens.colorNeutralForeground3, marginBottom: "16px", display: "block" }}>
          Publish a local package to the registry for testing
        </Text>
        <div className={styles.publishForm}>
          <div className={styles.formRow}>
            <Input
              placeholder="Package path (e.g. C:\dev\my-package)"
              style={{ flex: 1 }}
              value={publishPath}
              onChange={(_, data) => setPublishPath(data.value)}
            />
            <FilePickerButton onSelect={setPublishPath} />
          </div>
          <Button
            appearance="primary"
            icon={publishLoading ? <Spinner size="tiny" /> : <ArrowUploadRegular />}
            onClick={handlePublish}
            disabled={!publishPath || !registryRunning || publishLoading}
          >
            {publishLoading ? "Publishing..." : "Publish to Local Registry"}
          </Button>
          {!registryRunning && (
            <Text style={{ color: tokens.colorPaletteRedForeground1, fontSize: "12px" }}>
              ⚠ Start the registry first before publishing
            </Text>
          )}
        </div>
      </Card>

      {/* Published Packages */}
      {publishedPackages.length > 0 && (
        <Card className={mergeClasses(shared.card, styles.configCard)}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Title3>Published Packages</Title3>
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
              {publishedPackages.length}
            </Text>
          </div>
          <div className={styles.packageList}>
            {publishedPackages.map((pkg, index) => (
              <div key={index} className={styles.packageItem}>
                <Text weight="semibold">{pkg}</Text>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Usage Instructions */}
      <Card className={mergeClasses(shared.card, styles.configCard)}>
        <Title3>Usage</Title3>
        <pre style={{
          backgroundColor: tokens.colorNeutralBackground3,
          padding: "16px",
          borderRadius: "8px",
          marginTop: "12px",
          fontFamily: "monospace",
          fontSize: "13px",
          overflowX: "auto"
        }}>
          {`# To install from local registry in your project:
npm install <package-name> --registry http://localhost:${registryPort}

# Or set it globally for a project:
npm config set registry http://localhost:${registryPort}

# To publish a package to local registry:
npm publish --registry http://localhost:${registryPort}

# Reset to default registry:
npm config set registry https://registry.npmjs.org`}
        </pre>
      </Card>
    </div>
  );
};
