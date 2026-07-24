import React, { useEffect, useState } from "react";
import { Card, Text, Badge, tokens, makeStyles } from "@fluentui/react-components";
import { WarningRegular, ShieldCheckmarkRegular, ErrorCircleRegular } from "@fluentui/react-icons";
import { projectApi, ScriptInfo } from "../../services/tauriApi";
import { LinkMethod } from "../../types/link";
import { useSettingsStore } from "../../store/useSettingsStore";

const useStyles = makeStyles({
  container: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    marginTop: "12px",
  },
  scriptRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 12px",
    borderRadius: "6px",
    fontFamily: "monospace",
    fontSize: "12px",
    backgroundColor: tokens.colorNeutralBackground3,
  },
  safeRow: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    color: tokens.colorPaletteGreenForeground1,
  },
  warningHeader: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    color: tokens.colorPaletteRedForeground1,
  },
  yalcWarningHeader: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    color: tokens.colorPaletteDarkOrangeForeground1,
  },
  willRunHeader: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    color: tokens.colorPaletteRedForeground1,
  },
});

interface ScriptPreviewPanelProps {
  sourcePath: string;
  method: LinkMethod;
}

export const ScriptPreviewPanel: React.FC<ScriptPreviewPanelProps> = ({ sourcePath, method }) => {
  const styles = useStyles();
  const [scripts, setScripts] = useState<ScriptInfo[]>([]);
  const { config } = useSettingsStore();
  const allowLifecycleScripts = config?.general.allow_lifecycle_scripts ?? false;

  useEffect(() => {
    if (!sourcePath) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setScripts([]);
      return;
    }
    let cancelled = false;
    projectApi
      .getPackageScripts(sourcePath)
      .then((result) => {
        if (!cancelled) setScripts(result);
      })
      .catch(() => {
        if (!cancelled) setScripts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [sourcePath]);

  if (!sourcePath) return null;

  const lifecycleScripts = scripts.filter((s) => s.is_lifecycle);

  if (lifecycleScripts.length === 0) {
    return (
      <Card className={styles.container} style={{ padding: "8px 12px" }}>
        <div className={styles.safeRow}>
          <ShieldCheckmarkRegular />
          <Text size={200}>No lifecycle scripts detected in this package&apos;s package.json.</Text>
        </div>
      </Card>
    );
  }

  const isYalc = method === "Yalc";

  return (
    <Card className={styles.container} style={{ padding: "12px" }}>
      {isYalc ? (
        <div className={styles.yalcWarningHeader}>
          <ErrorCircleRegular />
          <Text size={200} weight="semibold">
            {lifecycleScripts.length} lifecycle script{lifecycleScripts.length !== 1 ? "s" : ""} detected — Yalc
            always runs prepare/prepack scripts for this package, regardless of the lifecycle-scripts setting.
            There is no way to suppress this for Yalc specifically.
          </Text>
        </div>
      ) : allowLifecycleScripts ? (
        <div className={styles.willRunHeader}>
          <ErrorCircleRegular />
          <Text size={200} weight="semibold">
            {lifecycleScripts.length} lifecycle script{lifecycleScripts.length !== 1 ? "s" : ""} detected — these
            WILL run because "Allow Lifecycle Scripts" is enabled in Settings.
          </Text>
        </div>
      ) : (
        <div className={styles.warningHeader}>
          <WarningRegular />
          <Text size={200} weight="semibold">
            {lifecycleScripts.length} lifecycle script{lifecycleScripts.length !== 1 ? "s" : ""} detected — will
            NOT run unless you enable lifecycle scripts in Settings.
          </Text>
        </div>
      )}
      {lifecycleScripts.map((script) => (
        <div key={script.name} className={styles.scriptRow}>
          <Text size={200}>
            {script.name}: {script.command}
          </Text>
          <Badge
            color={script.risk_level === "high" ? "danger" : script.risk_level === "medium" ? "warning" : "informative"}
          >
            {script.risk_level}
          </Badge>
        </div>
      ))}
    </Card>
  );
};
