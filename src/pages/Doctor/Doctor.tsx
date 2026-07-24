import React, { useState } from "react";
import {
  makeStyles,
  tokens,
  Card,
  Title3,
  Text,
  Button,
  Spinner,
  mergeClasses,
} from "@fluentui/react-components";
import {
  StethoscopeRegular,
} from "@fluentui/react-icons";
import { doctorApi } from "../../services/tauriApi";
import { useDoctorStore } from "../../store/useDoctorStore";
import { DoctorCheckItem } from "./DoctorCheckItem";
import { useSharedStyles } from "../../styles/useSharedStyles";

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
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "16px",
  },
  statCard: {
    padding: "32px 24px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    borderTop: `4px solid transparent`,
  },

  summaryValue: {
    fontSize: "28px",
    fontWeight: "700",
  },
  resultsList: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  resultCategory: {
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
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

export const Doctor: React.FC = () => {
  const styles = useStyles();
  const shared = useSharedStyles();
  const { results, hasRun, setResults } = useDoctorStore();
  const [loading, setLoading] = useState(false);

  const runDiagnostics = async () => {
    setLoading(true);
    try {
      const diagnostics = await doctorApi.runDiagnostics();
      setResults(diagnostics);
    } catch (error) {
      console.error("Diagnostics failed:", error);
    } finally {
      setLoading(false);
    }
  };

  const passCount = results.filter((r) => r.status === "Pass").length;
  const warnCount = results.filter((r) => r.status === "Warning").length;
  const failCount = results.filter((r) => r.status === "Fail").length;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Title3>System Doctor</Title3>
        <Button
          appearance="primary"
          icon={loading ? <Spinner size="tiny" /> : <StethoscopeRegular />}
          onClick={runDiagnostics}
          disabled={loading}
        >
          {loading ? "Running Diagnostics..." : hasRun ? "Re-run Diagnostics" : "Run Diagnostics"}
        </Button>
      </div>

      <Text>
        Check your system for required configuration, permissions and common issues that might affect local package testing.
      </Text>

      {!hasRun ? (
        <Card className={mergeClasses(shared.card, styles.emptyState)}>
          <StethoscopeRegular style={{ fontSize: "48px", color: tokens.colorNeutralForeground3 }} />
          <Title3>Ready to Diagnose</Title3>
          <Text align="center">
            Click "Run Diagnostics" to check your system for Node.js, package managers,
            <br/>
            symlink permissions, and other requirements.
          </Text>
          <Button appearance="primary" onClick={runDiagnostics}>
            Run Diagnostics
          </Button>
        </Card>
      ) : (
        <>
          {/* Summary */}
          {/* Summary */}
          <div className={styles.statsGrid}>
            <Card className={mergeClasses(shared.card, styles.statCard, shared.cardAccentTop, shared.cardAccentSuccess)}>
              <Text className={styles.summaryValue} style={{ color: tokens.colorPaletteGreenForeground1 }}>
                {passCount}
              </Text>
              <Text weight="semibold">Passed</Text>
            </Card>
            <Card className={mergeClasses(shared.card, styles.statCard, shared.cardAccentTop, shared.cardAccentWarning)}>
              <Text className={styles.summaryValue} style={{ color: tokens.colorPaletteYellowForeground1 }}>
                {warnCount}
              </Text>
              <Text weight="semibold">Warnings</Text>
            </Card>
            <Card className={mergeClasses(shared.card, styles.statCard, shared.cardAccentTop, shared.cardAccentDanger)}>
              <Text className={styles.summaryValue} style={{ color: tokens.colorPaletteRedForeground1 }}>
                {failCount}
              </Text>
              <Text weight="semibold">Failed</Text>
            </Card>
          </div>

          {/* Results */}
          <div className={styles.resultsList}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 0" }}>
              <Title3 style={{ padding: 0 }}>Diagnostic Results</Title3>
              {results.length > 0 && (
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
                  {results.length} {results.length === 1 ? "check" : "checks"}
                </Text>
              )}
            </div>
            
            <div className={styles.resultsList}>
              {results.map((result, index) => (
                <DoctorCheckItem key={index} result={result} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

