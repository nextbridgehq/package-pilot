import React from "react";
import { makeStyles, tokens, Card, Badge, Spinner, Text, Button } from "@fluentui/react-components";
import { CopyRegular, CheckmarkRegular } from "@fluentui/react-icons";
import type { Vulnerability } from "./useSecurityAudit";

const useStyles = makeStyles({
  content: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  vulnCard: {
    padding: "12px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  rawError: {
    padding: "12px",
    backgroundColor: tokens.colorStatusDangerBackground1,
    color: tokens.colorStatusDangerForeground1,
    borderRadius: "4px",
    wordBreak: "break-all",
    whiteSpace: "pre-wrap",
    fontFamily: "monospace",
    fontSize: "12px",
  },
});

interface Props {
  loading: boolean;
  vulnerabilities: Vulnerability[] | null;
  rawOutput: string | null;
  error: string | null;
}

// eslint-disable-next-line react-refresh/only-export-components
export const getSeverityColor = (severity: string) => {
  const s = severity.toLowerCase();
  if (s === "critical") return "danger";
  if (s === "high") return "severe";
  if (s === "moderate") return "warning";
  return "brand";
};

export const SecurityAuditResults: React.FC<Props> = ({ loading, vulnerabilities, rawOutput, error }) => {
  const styles = useStyles();
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    if (!vulnerabilities) return;
    const lines = vulnerabilities.map(
      (v) => `- [${v.severity.toUpperCase()}] ${v.module_name}\n  ${v.title}`
    );
    const text = `Security Audit: Found ${vulnerabilities.length} vulnerabilities\n\n${lines.join("\n\n")}`;
    
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  return (
    <div className={styles.content}>
      {loading && <Spinner label="Running audit..." />}

      {error && <div className={styles.rawError}>{error}</div>}

      {rawOutput && !error && (
        <div>
          <Text weight="semibold">Raw Output (could not parse nicely):</Text>
          <div className={styles.rawError}>{rawOutput}</div>
        </div>
      )}

      {vulnerabilities && vulnerabilities.length === 0 && (
        <Text>No vulnerabilities found! 🎉</Text>
      )}

      {vulnerabilities && vulnerabilities.length > 0 && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Text weight="semibold">Found {vulnerabilities.length} vulnerabilities</Text>
            <Button
              appearance="subtle"
              icon={copied ? <CheckmarkRegular /> : <CopyRegular />}
              onClick={handleCopy}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          {vulnerabilities.map((v, i) => (
            <Card key={i} className={styles.vulnCard}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <Text weight="semibold">{v.module_name}</Text>
                <Badge color={getSeverityColor(v.severity) as any}>
                  {v.severity.toUpperCase()}
                </Badge>
              </div>
              <Text size={200}>{v.title}</Text>
            </Card>
          ))}
        </>
      )}
    </div>
  );
};
