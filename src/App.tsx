import React, { useEffect } from "react";
import { AppLayout } from "./components/layout/AppLayout";
import { ErrorBoundary } from "./components/layout/ErrorBoundary";
import { useSettingsStore } from "./store/useSettingsStore";
import { FluentProvider } from "@fluentui/react-components";
import { packlabLightTheme, packlabDarkTheme } from "./theme";
import { initLogListener } from "./store/useLogStore";

function App() {
  const theme = useSettingsStore((state) => state.theme);
  const fetchConfig = useSettingsStore((state) => state.fetchConfig);

  useEffect(() => {
    fetchConfig();
    
    let unlistenFn: (() => void) | null = null;
    initLogListener().then((unlisten) => {
      unlistenFn = unlisten;
    });

    return () => {
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, [fetchConfig]);

  return (
    <FluentProvider theme={theme === "dark" ? packlabDarkTheme : packlabLightTheme}>
      <ErrorBoundary>
        <AppLayout />
      </ErrorBoundary>
    </FluentProvider>
  );
}

export default App;