import React from "react";
import {
  makeStyles,
  tokens,
  Button,
  Tooltip,
} from "@fluentui/react-components";
import {
  WeatherMoonRegular,
  WeatherSunnyRegular,
  InfoRegular,
} from "@fluentui/react-icons";
import { useSettingsStore } from "../../store/useSettingsStore";

const useStyles = makeStyles({
  header: {
    height: "48px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 16px",
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    "-webkit-app-region": "drag" as any,
  },
  title: {
    fontSize: "14px",
    fontWeight: "600",
    color: tokens.colorNeutralForeground1,
  },
  actions: {
    display: "flex",
    gap: "4px",
    "-webkit-app-region": "no-drag" as any,
  },
});

export const Header: React.FC = () => {
  const styles = useStyles();
  const { theme, setTheme } = useSettingsStore();

  return (
    <div className={styles.header}>
      <span className={styles.title}>Test, Validate, and Debug Node.js packages before Publishing to NPM</span>
      <div className={styles.actions}>
        <Tooltip content={`Switch to ${theme === "light" ? "dark" : "light"} mode`} relationship="label">
          <Button
            appearance="subtle"
            icon={theme === "light" ? <WeatherMoonRegular /> : <WeatherSunnyRegular />}
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          />
        </Tooltip>
        <Tooltip content="About" relationship="label">
          <Button appearance="subtle" icon={<InfoRegular />} />
        </Tooltip>
      </div>
    </div>
  );
};