import React from "react";
import {
  makeStyles,
  tokens,
  Text,
  Badge,
  Button,
  Card,
} from "@fluentui/react-components";
import {
  CheckmarkCircleRegular,
  WarningRegular,
  DismissCircleRegular,
  WindowConsoleRegular,
} from "@fluentui/react-icons";
import { DiagnosticResult } from "../../services/tauriApi";
import { useTerminalStore } from "../../store/useTerminalStore";
import { useSharedStyles } from "../../styles/useSharedStyles";
import { mergeClasses } from "@fluentui/react-components";

const useStyles = makeStyles({
  resultItem: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
    padding: "16px 20px",
    backgroundColor: tokens.colorNeutralBackground1,
  },
  resultIcon: {
    fontSize: "24px",
  },
  resultInfo: {
    flex: 1,
  },
  resultCategory: {
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
});

export const DoctorCheckItem: React.FC<{ result: DiagnosticResult }> = ({ result }) => {
  const styles = useStyles();
  const shared = useSharedStyles();
  const openWithCommand = useTerminalStore((state) => state.openWithCommand);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "Pass":
        return <CheckmarkCircleRegular style={{ color: tokens.colorPaletteGreenForeground1 }} />;
      case "Warning":
        return <WarningRegular style={{ color: tokens.colorPaletteYellowForeground1 }} />;
      case "Fail":
        return <DismissCircleRegular style={{ color: tokens.colorPaletteRedForeground1 }} />;
      default:
        return null;
    }
  };

  return (
    <div className={mergeClasses(shared.card, styles.resultItem)}>
      <div className={styles.resultIcon}>{getStatusIcon(result.status)}</div>
      <div className={styles.resultInfo}>
        <div className={styles.resultCategory}>{result.category}</div>
        <Text weight="semibold">{result.check}</Text>
        <div style={{ color: tokens.colorNeutralForeground3, marginTop: "4px" }}>
          {result.message}
        </div>
        {result.fix_suggestion && result.status !== "Pass" && (
          <div style={{ marginTop: "8px", fontSize: "12px", color: tokens.colorBrandForeground1 }}>
            <Card className={shared.card} style={{ padding: "8px", backgroundColor: tokens.colorBrandBackground2 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>💡 {result.fix_suggestion}</div>
                {result.fix_command && (
                  <Button
                    appearance="primary"
                    size="small"
                    icon={<WindowConsoleRegular />}
                    onClick={() => openWithCommand(result.fix_command!)}
                  >
                    Fix it (Terminal)
                  </Button>
                )}
              </div>
            </Card>
          </div>
        )}
      </div>
      <Badge
        color={
          result.status === "Pass"
            ? "success"
            : result.status === "Warning"
            ? "warning"
            : "danger"
        }
        appearance="tint"
      >
        {result.status}
      </Badge>
    </div>
  );
};
