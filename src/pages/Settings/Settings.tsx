import React, { useEffect, useState } from "react";
import {
  makeStyles,
  tokens,
  Card,
  Title3,
  Text,
  Button,
  Input,
  Select,
  Switch,
  Divider,
  Tab,
  TabList,
  Spinner,
  Toaster,
  useId,
  useToastController,
  Toast,
  ToastTitle,
} from "@fluentui/react-components";
import { SaveRegular, ArrowResetRegular, DeleteRegular } from "@fluentui/react-icons";
import { useSettingsStore } from "../../store/useSettingsStore";
import { useSharedStyles } from "../../styles/useSharedStyles";
import { mergeClasses } from "@fluentui/react-components";
import { AppConfig } from "../../types/config";
import { FilePickerButton } from "../../components/common/FilePickerButton";

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
  section: {
    padding: "24px",
  },
  formGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  formRow: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
  },
  label: {
    minWidth: "200px",
    fontWeight: "600",
  },
  description: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    marginTop: "4px",
  },
  formItem: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "12px 0",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  formItemRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  actions: {
    display: "flex",
    gap: "12px",
    justifyContent: "flex-end",
    marginTop: "24px",
  },
  tagInput: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    marginTop: "8px",
  },
});

export const Settings: React.FC = () => {
  const styles = useStyles();
  const shared = useSharedStyles();
  const { config, fetchConfig, saveConfig, theme, setTheme } = useSettingsStore();
  const [localConfig, setLocalConfig] = useState<AppConfig | null>(null);
  const [currentTab, setCurrentTab] = useState("general");
  const [saving, setSaving] = useState(false);
  const [newPattern, setNewPattern] = useState("");

  const toasterId = useId("settings-toaster");
  const { dispatchToast } = useToastController(toasterId);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  useEffect(() => {
    if (config) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLocalConfig({ ...config });
    }
  }, [config]);

  const handleSave = async () => {
    if (!localConfig) return;
    setSaving(true);
    try {
      await saveConfig(localConfig);
      dispatchToast(
        <Toast>
          <ToastTitle>Settings saved</ToastTitle>
        </Toast>,
        { intent: "success" }
      );
    } catch (error) {
      console.error("Failed to save config:", error);
      dispatchToast(
        <Toast>
          <ToastTitle>Failed to save settings</ToastTitle>
        </Toast>,
        { intent: "error" }
      );
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (config) {
      setLocalConfig({ ...config });
    }
  };

  const handleAddPattern = () => {
    const pattern = newPattern.trim();
    if (pattern && localConfig && !localConfig.watcher.ignore_patterns.includes(pattern)) {
      setLocalConfig({
        ...localConfig,
        watcher: {
          ...localConfig.watcher,
          ignore_patterns: [...localConfig.watcher.ignore_patterns, pattern],
        },
      });
      setNewPattern("");
    }
  };

  const handleRemovePattern = (index: number) => {
    if (!localConfig) return;
    const newPatterns = [...localConfig.watcher.ignore_patterns];
    newPatterns.splice(index, 1);
    setLocalConfig({
      ...localConfig,
      watcher: {
        ...localConfig.watcher,
        ignore_patterns: newPatterns,
      },
    });
  };

  if (!localConfig) {
    return <Spinner label="Loading settings..." />;
  }

  return (
    <div className={styles.container}>
      <Toaster toasterId={toasterId} position="top-end" />
      <div className={styles.header}>
        <Title3>Settings</Title3>
      </div>

      <TabList
        selectedValue={currentTab}
        onTabSelect={(_, data) => setCurrentTab(data.value as string)}
      >
        <Tab value="general">General</Tab>
        <Tab value="watcher">Watcher</Tab>
        <Tab value="appearance">Appearance</Tab>
      </TabList>

      {/* General Settings */}
      {currentTab === "general" && (
        <Card className={mergeClasses(shared.card, styles.section)}>
          <Title3>General Settings</Title3>
          <Divider style={{ margin: "16px 0" }} />
          <div className={styles.formGroup}>
            <div className={styles.formItem}>
              <div className={styles.formItemRow}>
                <div>
                  <Text weight="semibold">Default Package Manager</Text>
                  <div className={styles.description}>
                    Used when no lock file is detected
                  </div>
                </div>
                <Select
                  value={localConfig.general.default_package_manager}
                  onChange={(_, data) =>
                    setLocalConfig({
                      ...localConfig,
                      general: {
                        ...localConfig.general,
                        default_package_manager: data.value,
                      },
                    })
                  }
                >
                  <option value="npm">npm</option>
                  <option value="yarn">Yarn</option>
                  <option value="pnpm">pnpm</option>
                </Select>
              </div>
            </div>

            <div className={styles.formItem}>
              <div className={styles.formItemRow}>
                <div>
                  <Text weight="semibold">Auto Build on Link</Text>
                  <div className={styles.description}>
                    Automatically run build script before creating a link
                  </div>
                </div>
                <Switch
                  checked={localConfig.general.auto_build_on_link}
                  onChange={(_, data) =>
                    setLocalConfig({
                      ...localConfig,
                      general: {
                        ...localConfig.general,
                        auto_build_on_link: data.checked,
                      },
                    })
                  }
                />
              </div>
            </div>

            <div className={styles.formItem}>
              <div className={styles.formItemRow}>
                <div>
                  <Text weight="semibold">Allow Lifecycle Scripts</Text>
                  <div className={styles.description}>
                    Run postinstall/prepare/prepack scripts when linking packages. Off by default —
                    a malicious linked package could otherwise execute arbitrary code during install.
                  </div>
                </div>
                <Switch
                  checked={localConfig.general.allow_lifecycle_scripts}
                  onChange={(_, data) =>
                    setLocalConfig({
                      ...localConfig,
                      general: {
                        ...localConfig.general,
                        allow_lifecycle_scripts: data.checked,
                      },
                    })
                  }
                />
              </div>
            </div>

            <div className={styles.formItem}>
              <div className={styles.formItemRow}>
                <div>
                  <Text weight="semibold">Auto Install Dependencies</Text>
                  <div className={styles.description}>
                    Run npm install after linking
                  </div>
                </div>
                <Switch
                  checked={localConfig.general.auto_install_deps}
                  onChange={(_, data) =>
                    setLocalConfig({
                      ...localConfig,
                      general: {
                        ...localConfig.general,
                        auto_install_deps: data.checked,
                      },
                    })
                  }
                />
              </div>
            </div>

            <div className={styles.formItem}>
              <div className={styles.formItemRow}>
                <div>
                  <Text weight="semibold">Default Projects Directory</Text>
                  <div className={styles.description}>
                    Default location when browsing for projects
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <Input
                    value={localConfig.general.projects_directory || ""}
                    onChange={(_, data) =>
                      setLocalConfig({
                        ...localConfig,
                        general: {
                          ...localConfig.general,
                          projects_directory: data.value || null,
                        },
                      })
                    }
                    placeholder="C:\projects"
                    style={{ width: "250px" }}
                  />
                  <FilePickerButton
                    onSelect={(path) =>
                      setLocalConfig({
                        ...localConfig,
                        general: { ...localConfig.general, projects_directory: path },
                      })
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Watcher Settings */}
      {currentTab === "watcher" && (
        <Card className={mergeClasses(shared.card, styles.section)}>
          <Title3>Watcher Settings</Title3>
          <Divider style={{ margin: "16px 0" }} />
          <div className={styles.formGroup}>
            <div className={styles.formItem}>
              <div className={styles.formItemRow}>
                <div>
                  <Text weight="semibold">Debounce (ms)</Text>
                  <div className={styles.description}>
                    Delay before triggering rebuild after file change
                  </div>
                </div>
                <Input
                  type="number"
                  value={localConfig.watcher.debounce_ms.toString()}
                  onChange={(_, data) =>
                    setLocalConfig({
                      ...localConfig,
                      watcher: {
                        ...localConfig.watcher,
                        debounce_ms: parseInt(data.value) || 500,
                      },
                    })
                  }
                  style={{ width: "120px" }}
                />
              </div>
            </div>

            <div className={styles.formItem}>
              <div className={styles.formItemRow}>
                <div>
                  <Text weight="semibold">Auto Rebuild</Text>
                  <div className={styles.description}>
                    Automatically rebuild and re-link when files change
                  </div>
                </div>
                <Switch
                  checked={localConfig.watcher.auto_rebuild}
                  onChange={(_, data) =>
                    setLocalConfig({
                      ...localConfig,
                      watcher: { ...localConfig.watcher, auto_rebuild: data.checked },
                    })
                  }
                />
              </div>
            </div>

            <div className={styles.formItem}>
              <div>
                <Text weight="semibold">Ignore Patterns</Text>
                <div className={styles.description}>
                  Directories/files to ignore when watching
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}>
                {localConfig.watcher.ignore_patterns.map((pattern, index) => (
                  <div key={pattern} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <Input value={pattern} readOnly style={{ flex: 1 }} />
                    <Button
                      appearance="subtle"
                      icon={<DeleteRegular />}
                      onClick={() => handleRemovePattern(index)}
                    />
                  </div>
                ))}
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Input
                    placeholder="Add new pattern..."
                    style={{ flex: 1 }}
                    value={newPattern}
                    onChange={(e, data) => setNewPattern(data.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleAddPattern();
                      }
                    }}
                  />
                  <Button
                    onClick={handleAddPattern}
                  >
                    Add
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Appearance Settings */}
      {currentTab === "appearance" && (
        <Card className={mergeClasses(shared.card, styles.section)}>
          <Title3>Appearance Settings</Title3>
          <Divider style={{ margin: "16px 0" }} />
          <div className={styles.formGroup}>
            <div className={styles.formItem}>
              <div className={styles.formItemRow}>
                <div>
                  <Text weight="semibold">Theme</Text>
                  <div className={styles.description}>
                    Choose your preferred color theme
                  </div>
                </div>
                <Select
                  value={theme}
                  onChange={(_, data) => setTheme(data.value as "light" | "dark" | "system")}
                >
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                  <option value="system">System</option>
                </Select>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Save/Reset Actions */}
      <div className={styles.actions}>
        <Button appearance="secondary" icon={<ArrowResetRegular />} onClick={handleReset}>
          Reset
        </Button>
        <Button
          appearance="primary"
          icon={saving ? <Spinner size="tiny" /> : <SaveRegular />}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Saving..." : "Save Settings"}
        </Button>
      </div>
    </div>
  );
};

