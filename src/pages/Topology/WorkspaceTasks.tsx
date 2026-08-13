import React from "react";
import {
  makeStyles,
  tokens,
  Button,
  Title3,
  Text,
  Toaster,
  useToastController,
  useId,
  Toast,
  ToastTitle,
  ToastBody,
} from "@fluentui/react-components";
import { PlayRegular, BoxRegular, GridDotsRegular } from "@fluentui/react-icons";
import { useProjectStore } from "../../store/useProjectStore";
import { commands } from "../../bindings";
import { useTerminalStore } from "../../store/useTerminalStore";

const useStyles = makeStyles({
  container: {
    width: "300px",
    backgroundColor: tokens.colorNeutralBackground2,
    borderLeft: `1px solid ${tokens.colorNeutralStroke1}`,
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    height: "100%",
    boxSizing: "border-box",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  title: {
    color: tokens.colorBrandForeground1,
  },
  taskList: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  taskButton: {
    justifyContent: "flex-start",
  },
});

export const WorkspaceTasks: React.FC = () => {
  const styles = useStyles();
  const selectedProject = useProjectStore((s) => s.selectedProject);
  const openWithSession = useTerminalStore((s) => s.openWithSession);
  const openWithSessions = useTerminalStore((s) => s.openWithSessions);
  const [runningTask, setRunningTask] = React.useState<string | null>(null);

  const toasterId = useId("workspace-tasks-toaster");
  const { dispatchToast } = useToastController(toasterId);

  const reportFailure = React.useCallback(
    (title: string, detail: unknown) => {
      console.error(title, detail);
      dispatchToast(
        <Toast>
          <ToastTitle>{title}</ToastTitle>
          <ToastBody>{String(detail)}</ToastBody>
        </Toast>,
        { intent: "error" },
      );
    },
    [dispatchToast],
  );

  // Every hook must run before this early return.
  if (!selectedProject || !selectedProject.workspace_tool || selectedProject.workspace_tool === "None") {
    return null;
  }

  const toolName = selectedProject.workspace_tool === "Turbo" ? "Turborepo" : 
                   selectedProject.workspace_tool === "Lerna" ? "Lerna" : 
                   selectedProject.workspace_tool;

  const handleRunTask = async (task: string) => {
    setRunningTask(task);
    try {
      const res = await commands.runWorkspaceTask(selectedProject.id, task);
      if (res.status === "ok") {
        openWithSession({ id: res.data, title: task, cwd: selectedProject.path });
      } else {
        reportFailure(`Could not run "${task}"`, res.error);
      }
    } catch (error) {
      reportFailure(`Could not run "${task}"`, error);
    } finally {
      setRunningTask(null);
    }
  };

  const handleRunMultiplexed = async (task: string) => {
    setRunningTask(task);
    try {
      // Pick up to 4 packages to avoid overloading the screen/PTY limit
      const packages = selectedProject.packages.slice(0, 4);

      if (packages.length === 0) {
        reportFailure(
          `Could not run "${task}"`,
          "This workspace has no packages to run the task in.",
        );
        return;
      }

      const sessions: { id: string; title: string; cwd: string }[] = [];
      const failures: string[] = [];

      for (const pkg of packages) {
        const res = await commands.runPackageTask(selectedProject.id, pkg.name, task);
        if (res.status === "ok") {
          sessions.push({ id: res.data, title: pkg.name, cwd: selectedProject.path });
        } else {
          failures.push(`${pkg.name}: ${res.error}`);
        }
      }

      if (sessions.length > 0) {
        openWithSessions(sessions);
      }
      // Report failures even when some panes started, so a partial run is visible.
      if (failures.length > 0) {
        reportFailure(`Could not run "${task}" in every package`, failures.join("; "));
      }
    } catch (error) {
      reportFailure(`Could not run "${task}"`, error);
    } finally {
      setRunningTask(null);
    }
  };

  const tasks = ["build", "test", "lint"];

  return (
    <div className={styles.container}>
      <Toaster toasterId={toasterId} position="top-end" />
      <div className={styles.header}>
        <BoxRegular fontSize={24} />
        <Title3 className={styles.title}>{toolName} Detected</Title3>
      </div>
      <Text>Common Workspace Tasks</Text>
      
      <Button
        appearance="primary"
        icon={<GridDotsRegular />}
        onClick={() => handleRunMultiplexed("dev")}
        disabled={runningTask !== null}
        className={styles.taskButton}
      >
        Run All Dev (Multiplexed)
      </Button>

      <div className={styles.taskList}>
        {tasks.map((task) => (
          <Button
            key={task}
            icon={<PlayRegular />}
            onClick={() => handleRunTask(task)}
            disabled={runningTask !== null}
            className={styles.taskButton}
          >
            {task}
          </Button>
        ))}
      </div>
    </div>
  );
};
