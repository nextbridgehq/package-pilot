import React, { useEffect, useState } from "react";
import { Card, Text, Badge, tokens, makeStyles } from "@fluentui/react-components";
import { WarningRegular, ShieldCheckmarkRegular, ErrorCircleRegular } from "@fluentui/react-icons";
import { commands, ScriptInfo } from "../../bindings";
import { LinkMethod } from "../../types/link";
import { useSettingsStore } from "../../store/useSettingsStore";

const useStyles = makeStyles({
  container: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    marginTop: "12px",
  },
  scriptCardHigh: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "12px",
    borderRadius: "6px",
    backgroundColor: tokens.colorNeutralBackground3,
    borderLeft: `4px solid ${tokens.colorPaletteRedBorderActive}`,
  },
  scriptCardMedium: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "12px",
    borderRadius: "6px",
    backgroundColor: tokens.colorNeutralBackground3,
    borderLeft: `4px solid ${tokens.colorPaletteDarkOrangeBorderActive}`,
  },
  scriptCardLow: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "12px",
    borderRadius: "6px",
    backgroundColor: tokens.colorNeutralBackground3,
    borderLeft: `4px solid ${tokens.colorNeutralStroke1}`,
  },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "8px",
  },
  scriptName: {
    fontFamily: "monospace",
    fontWeight: 600,
    fontSize: "14px",
  },
  badgeGroup: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap",
    alignItems: "center",
  },
  commandBox: {
    fontFamily: "monospace",
    fontSize: "12px",
    backgroundColor: tokens.colorNeutralBackground1,
    padding: "8px 10px",
    borderRadius: "4px",
    overflowX: "auto",
  },
  rationaleRow: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontSize: "11px",
    color: tokens.colorNeutralForeground2,
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
    commands
      .getPackageScripts(sourcePath)
      .then((res) => {
        if (!cancelled) setScripts(res.status === "ok" ? res.data || [] : []);
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
      <Card className={styles.container} style={{ padding: "10px 14px" }}>
        <div className={styles.safeRow}>
          <ShieldCheckmarkRegular />
          <Text size={200}>No lifecycle scripts detected in this package&apos;s package.json.</Text>
        </div>
      </Card>
    );
  }

  const isYalc = method === "Yalc";

  return (
    <Card className={styles.container} style={{ padding: "14px" }}>
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

      {lifecycleScripts.map((script) => {
        const risk = script.risk_level?.toLowerCase() || "low";
        const cardStyle =
          risk === "high"
            ? styles.scriptCardHigh
            : risk === "medium"
            ? styles.scriptCardMedium
            : styles.scriptCardLow;
        const badgeColor =
          risk === "high" ? "danger" : risk === "medium" ? "warning" : "informative";
        const badgeText = risk.toUpperCase() + " RISK";

        return (
          <div key={script.name} className={cardStyle}>
            <div className={styles.headerRow}>
              <span className={styles.scriptName}>{script.name}</span>
              <div className={styles.badgeGroup}>
                <Badge color={badgeColor} appearance="filled">
                  {badgeText}
                </Badge>
                {script.threat_categories?.map((category) => (
                  <Badge key={category} color="subtle" appearance="outline">
                    {category}
                  </Badge>
                ))}
              </div>
            </div>
            <div className={styles.commandBox}>{script.command}</div>
            {script.risk_explanation && (
              <div className={styles.rationaleRow}>
                {risk === "high" ? (
                  <ErrorCircleRegular style={{ color: tokens.colorPaletteRedForeground1 }} />
                ) : risk === "medium" ? (
                  <WarningRegular style={{ color: tokens.colorPaletteDarkOrangeForeground1 }} />
                ) : (
                  <ShieldCheckmarkRegular style={{ color: tokens.colorPaletteGreenForeground1 }} />
                )}
                <Text size={100}>
                  <strong>Security Analysis:</strong> {script.risk_explanation}
                </Text>
              </div>
            )}
          </div>
        );
      })}
    </Card>
  );
};
