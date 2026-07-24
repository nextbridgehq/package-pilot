import React, { useEffect, useState, useRef } from "react";
import {
  makeStyles,
  tokens,
  Dialog,
  DialogSurface,
  DialogBody,
  Input,
  Text,
  mergeClasses,
} from "@fluentui/react-components";
import { SearchRegular } from "@fluentui/react-icons";
import { useProjectStore } from "../../store/useProjectStore";
import { useLinkStore } from "../../store/useLinkStore";
import { utilityApi, doctorApi } from "../../services/tauriApi";
import { useToastController, Toast, ToastTitle, Toaster, useId } from "@fluentui/react-components";

const useStyles = makeStyles({
  searchContainer: {
    padding: "16px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
  },
  searchInput: {
    width: "100%",
  },
  resultsContainer: {
    maxHeight: "300px",
    overflowY: "auto",
    padding: "8px",
  },
  resultItem: {
    padding: "12px",
    borderRadius: "4px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "12px",
    "&:hover": {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  resultItemSelected: {
    backgroundColor: tokens.colorNeutralBackground1Selected,
    "&:hover": {
      backgroundColor: tokens.colorNeutralBackground1Selected,
    },
  },
  emptyState: {
    padding: "24px",
    textAlign: "center",
    color: tokens.colorNeutralForeground3,
  },
});

interface Action {
  id: string;
  label: string;
  icon?: React.ReactNode;
  perform: () => void;
}

export const CommandPalette: React.FC<{ onNavigate?: (path: string) => void }> = ({ onNavigate }) => {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const toasterId = useId("cmd-toaster");
  const { dispatchToast } = useToastController(toasterId);

  const { setAutoOpenAddDialog } = useProjectStore();
  const { setPendingTab } = useLinkStore();

  const actions: Action[] = [
    {
      id: "add-project",
      label: "Add New Project...",
      perform: () => {
        if (onNavigate) onNavigate("projects");
        setAutoOpenAddDialog(true);
      },
    },
    {
      id: "create-link",
      label: "Create New Link...",
      perform: () => {
        if (onNavigate) onNavigate("links");
        setPendingTab("create");
      },
    },

    {
      id: "export-diagnostics",
      label: "Export Diagnostics...",
      perform: async () => {
        try {
          const path = await doctorApi.exportDiagnostics();
          if (path) {
            dispatchToast(<Toast><ToastTitle>Diagnostics exported to {path}</ToastTitle></Toast>, { intent: "success" });
          }
        } catch (err: any) {
          dispatchToast(<Toast><ToastTitle>{err.toString()}</ToastTitle></Toast>, { intent: "error" });
        }
      },
    },
    {
      id: "view-logs",
      label: "View System Logs",
      perform: () => {
        if (onNavigate) onNavigate("logs");
      },
    },
    {
      id: "run-doctor",
      label: "Run Doctor Diagnostics",
      perform: () => {
        if (onNavigate) onNavigate("doctor");
      },
    },
  ];

  const filteredActions = search
    ? actions.filter((a) => a.label.toLowerCase().includes(search.toLowerCase()))
    : actions;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        setSearch("");
        setSelectedIndex(0);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((s) => Math.min(s + 1, filteredActions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredActions[selectedIndex]) {
        filteredActions[selectedIndex].perform();
        setOpen(false);
      }
    }
  };

  return (
    <>
      <Toaster toasterId={toasterId} position="top-end" />
      <Dialog open={open} onOpenChange={(_, data) => setOpen(data.open)}>
        <DialogSurface style={{ padding: 0, overflow: "hidden", minWidth: "500px" }}>
          <DialogBody>
            <div className={styles.searchContainer}>
              <Input
                ref={inputRef}
                className={styles.searchInput}
                placeholder="Type a command or search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleKeyDown}
                contentBefore={<SearchRegular />}
                appearance="outline"
                size="large"
              />
            </div>
            <div className={styles.resultsContainer}>
              {filteredActions.length === 0 ? (
                <div className={styles.emptyState}>No commands found.</div>
              ) : (
                filteredActions.map((action, i) => (
                  <div
                    key={action.id}
                    className={mergeClasses(
                      styles.resultItem,
                      i === selectedIndex && styles.resultItemSelected
                    )}
                    onMouseEnter={() => setSelectedIndex(i)}
                    onClick={() => {
                      action.perform();
                      setOpen(false);
                    }}
                  >
                    {action.icon}
                    <Text weight={i === selectedIndex ? "semibold" : "regular"}>
                      {action.label}
                    </Text>
                  </div>
                ))
              )}
            </div>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  );
};
