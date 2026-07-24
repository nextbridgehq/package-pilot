import React, { useState, useEffect } from "react";
import {
  makeStyles,
  tokens,
  Card,
  Text,
  Button,
  Input,
  Combobox,
  Option,
  OptionGroup,
  Checkbox,
  Divider,
  Spinner,
  mergeClasses,
  useToastController,
  Toast,
  ToastTitle,
  ToastBody,
  Tooltip,
} from "@fluentui/react-components";
import { LinkRegular, AddRegular } from "@fluentui/react-icons";
import { useLinkStore } from "../../store/useLinkStore";
import { useProjectStore } from "../../store/useProjectStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { FilePickerButton } from "../../components/common/FilePickerButton";
import { ScriptPreviewPanel } from "./ScriptPreviewPanel";
import { projectApi } from "../../services/tauriApi";
import { LinkMethod, LinkRequest } from "../../types/link";
import { useSharedStyles } from "../../styles/useSharedStyles";

const useStyles = makeStyles({
  formCard: {
    padding: "24px",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  formRow: {
    display: "flex",
    gap: "12px",
    alignItems: "center",
  },
  methodGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "12px",
  },
  methodCard: {
    padding: "16px",
    cursor: "pointer",
    border: `2px solid transparent`,
    textAlign: "center",
    "&:hover": {
      borderTopColor: tokens.colorBrandStroke1,
      borderRightColor: tokens.colorBrandStroke1,
      borderBottomColor: tokens.colorBrandStroke1,
      borderLeftColor: tokens.colorBrandStroke1,
    },
  },
  methodCardSelected: {
    borderTopColor: tokens.colorBrandStroke1,
    borderRightColor: tokens.colorBrandStroke1,
    borderBottomColor: tokens.colorBrandStroke1,
    borderLeftColor: tokens.colorBrandStroke1,
    backgroundColor: tokens.colorBrandBackground2,
  },
  options: {
    display: "flex",
    gap: "24px",
    flexWrap: "wrap",
  },
});

const methodDescriptions: Partial<Record<LinkMethod, { label: string; description: string }>> = {
  ["Symlink"]: {
    label: "Symlink (npm link)",
    description: "Creates a symbolic link. Fast but may have Windows permission issues.",
  },
  ["NpmPack"]: {
    label: "npm pack",
    description: "Creates a tarball and installs it. Most realistic simulation.",
  },
  ["Yalc"]: {
    label: "Yalc",
    description: "Local publish/install. Best balance of speed and reliability.",
  },
  ["Workspace"]: {
    label: "Workspace (file:)",
    description: "Adds file: reference in package.json. Good for monorepos.",
  },
  ["FileCopy"]: {
    label: "File Copy",
    description: "Directly copies files to node_modules. Simple but manual.",
  },
};

interface LinkCreateFormProps {
  onSuccess: () => void;
  toasterId: string;
}

export const LinkCreateForm: React.FC<LinkCreateFormProps> = ({ onSuccess, toasterId }) => {
  const styles = useStyles();
  const shared = useSharedStyles();
  const { createLink, loading, error, draft, setDraft, resetDraftAfterCreate, applyConfigDefaultsOnce } = useLinkStore();
  const { projects } = useProjectStore();
  const { config, saveConfig } = useSettingsStore();
  const { dispatchToast } = useToastController(toasterId);

  const { sourcePath, targetPath, method, watchEnabled, buildFirst, installPeerDeps } = draft;
  const setSourcePath = (v: string) => setDraft({ sourcePath: v });
  const setTargetPath = (v: string) => setDraft({ targetPath: v });
  const setMethod = (v: LinkMethod) => setDraft({ method: v });
  const setWatchEnabled = (v: boolean) => setDraft({ watchEnabled: v });
  const setBuildFirst = (v: boolean) => setDraft({ buildFirst: v });
  const [hasCli, setHasCli] = useState(false);

  useEffect(() => {
    if (config) {
      applyConfigDefaultsOnce(config.general.auto_build_on_link, config.general.auto_install_deps);
    }
  }, [config, applyConfigDefaultsOnce]);

  const setInstallPeerDeps = (checked: boolean) => {
    setDraft({ installPeerDeps: checked });
    if (config) {
      saveConfig({
        ...config,
        general: { ...config.general, auto_install_deps: checked },
      });
    }
  };

  const allPackages = projects.flatMap((project) =>
    project.packages.map((pkg) => ({
      ...pkg,
      projectName: project.name,
    }))
  );

  useEffect(() => {
    if (!sourcePath) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHasCli(false);
      return;
    }
    const knownPackage = allPackages.find((p) => p.path === sourcePath);
    if (knownPackage) {
      setHasCli(knownPackage.has_cli ?? false);
    } else {
      projectApi
        .checkPackageCli(sourcePath)
        .then(setHasCli)
        .catch(() => setHasCli(false));
    }
  }, [sourcePath, allPackages]);

  const handleCreateLink = async () => {
    if (config?.general.allow_lifecycle_scripts && sourcePath) {
      try {
        const scripts = await projectApi.getPackageScripts(sourcePath);
        const lifecycleScripts = scripts.filter((s: any) => s.is_lifecycle);
        if (lifecycleScripts.length > 0) {
          const { confirm } = await import("@tauri-apps/plugin-dialog");
          const confirmed = await confirm(
            `This package has ${lifecycleScripts.length} lifecycle scripts that WILL execute:\n` +
            lifecycleScripts.map((s: any) => `  ${s.name}: ${s.command}`).join('\n') +
            '\n\nProceed?',
            { title: "Lifecycle Scripts Will Run", kind: "warning" }
          );
          if (!confirmed) return;
        }
      } catch (err) {
        console.error("Failed to fetch lifecycle scripts", err);
      }
    }

    const request: LinkRequest = {
      source_path: sourcePath,
      target_path: targetPath,
      method,
      watch: watchEnabled,
      build_first: buildFirst,
      install_peer_deps: installPeerDeps,
      allow_lifecycle_scripts: config?.general.allow_lifecycle_scripts ?? false,
    };
    try {
      await createLink(request);
      resetDraftAfterCreate();

      dispatchToast(
        <Toast>
          <ToastTitle>Link Created Successfully! 🎉</ToastTitle>
          <ToastBody>The package is now linked and ready for testing.</ToastBody>
        </Toast>,
        { intent: "success" }
      );

      onSuccess();
    } catch (err) {
      console.error("Failed to create link", err);
    }
  };

  const missingFields = [
    !sourcePath && "source package",
    !targetPath && "target project",
  ].filter(Boolean) as string[];

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      if (sourcePath && targetPath && !loading) {
        handleCreateLink();
      }
    }
  };

  return (
    <Card className={mergeClasses(shared.card, styles.formCard)} onKeyDown={handleKeyDown} tabIndex={0}>
      <div className={styles.form}>
        {/* Source Package */}
        <div>
          <Text weight="semibold" size={300}>
            Source Package (the package you're developing)
          </Text>
          <div className={styles.formRow} style={{ marginTop: "8px" }}>
            <Combobox
              freeform
              style={{ flex: 1 }}
              placeholder="Search packages by name..."
              value={sourcePath}
              onChange={(e: any) => setSourcePath(e.target.value)}
              onOptionSelect={(_e, data) => setSourcePath(data.optionValue || "")}
            >
              {projects.map((project) => (
                <OptionGroup label={project.name} key={project.id}>
                  {project.packages.map((pkg) => (
                    <Option key={pkg.path} value={pkg.path} text={`${pkg.name} ${pkg.version}`}>
                      {pkg.name} <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>v{pkg.version}</Text>
                    </Option>
                  ))}
                </OptionGroup>
              ))}
            </Combobox>
            <FilePickerButton onSelect={setSourcePath} iconOnly label="Browse for Source Package" />
          </div>
          <ScriptPreviewPanel sourcePath={sourcePath} method={method} />
        </div>

        {/* Target Project */}
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: "8px",
            }}
          >
            <Text weight="semibold" size={300}>
              Target Project (the project consuming the package)
            </Text>
            <Tooltip
              content={
                hasCli
                  ? "Auto-create a temporary sandbox folder"
                  : "Sandbox is only available for CLI packages. Please select a target project to test this library."
              }
              relationship="label"
            >
              <Button
                appearance="transparent"
                size="small"
                icon={<AddRegular />}
                disabled={!hasCli}
                onClick={async () => {
                  try {
                    const selectedPackage = allPackages.find((p) => p.path === sourcePath);
                    const path = await projectApi.createSandbox(selectedPackage?.path);
                    setTargetPath(path);
                  } catch (e) {
                    console.error("Failed to create sandbox", e);
                  }
                }}
              >
                Auto-create Sandbox
              </Button>
            </Tooltip>
          </div>
          <div className={styles.formRow}>
            <Input
              style={{ flex: 1 }}
              placeholder="C:\dev\my-app"
              value={targetPath}
              onChange={(_, data) => setTargetPath(data.value)}
              contentAfter={
                <FilePickerButton onSelect={setTargetPath} iconOnly label="Browse for Target Project" />
              }
            />
          </div>
        </div>

        <Divider />

        {/* Method Selection */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Text weight="semibold" size={300}>
              Link Method
            </Text>
          </div>
          <div
            className={styles.methodGrid}
            style={{
              marginTop: "12px",
              gridTemplateColumns: "repeat(3, 1fr)",
            }}
          >
            {Object.entries(methodDescriptions)
              .map(([key, value]) => (
                <Card
                  key={key}
                  className={mergeClasses(
                    styles.methodCard,
                    method === key && styles.methodCardSelected
                  )}
                  onClick={() => setMethod(key as LinkMethod)}
                >
                  <Text weight="semibold" size={300}>
                    {value.label}
                  </Text>
                  <Text
                    size={200}
                    style={{
                      color: tokens.colorNeutralForeground3,
                      marginTop: "4px",
                      display: "block",
                    }}
                  >
                    {value.description}
                  </Text>
                </Card>
              ))}
          </div>
        </div>

        <Divider />

        {/* Options */}
        <div>
          <Text weight="semibold" size={300}>
            Options
          </Text>
          <div className={styles.options} style={{ marginTop: "12px" }}>
            <Checkbox
              checked={watchEnabled}
              onChange={(_, data) => setWatchEnabled(!!data.checked)}
              label="Watch for changes & auto-rebuild"
            />
            <Checkbox
              checked={buildFirst}
              onChange={(_, data) => setBuildFirst(!!data.checked)}
              label="Run build before linking"
            />
            <Checkbox
              checked={installPeerDeps}
              onChange={(_, data) => setInstallPeerDeps(!!data.checked)}
              label="Install peer dependencies"
            />
          </div>
        </div>

        {/* Error */}
        {error && <Text style={{ color: tokens.colorPaletteRedForeground1 }}>{error}</Text>}

        {/* Why the button is disabled — explicit so it can never be confused
            with the (unrelated) lifecycle-script warning above. The button is
            gated purely on having both a source and a target, nothing else. */}
        {!loading && missingFields.length > 0 && (
          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
            Select a {missingFields.join(" and a ")} to create the link.
            {" "}
            {!targetPath &&
              (hasCli
                ? "Pick a target project — browse for one, paste its path, or use “Auto-create Sandbox”."
                : "Pick a target project — browse for the project you want to link this package into, or paste its path.")}
          </Text>
        )}

        {/* Submit */}
        <Button
          appearance="primary"
          icon={loading ? <Spinner size="tiny" /> : <LinkRegular />}
          disabled={!sourcePath || !targetPath || loading}
          onClick={handleCreateLink}
          size="large"
        >
          {loading ? "Creating Link..." : "Create Link"}
        </Button>
      </div>
    </Card>
  );
};

