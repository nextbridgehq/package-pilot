import React, { useEffect, useState } from "react";
import {
  makeStyles,
  tokens,
  Card,
  Title3,
  Text,
  Button,
  Badge,
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogContent,
  DialogActions,
  SkeletonItem,
  Toaster,
  useToastController,
  useId,
  Toast,
  ToastTitle,
  ToastTrigger,
} from "@fluentui/react-components";
import {
  AddRegular,
  DeleteRegular,
  FolderOpenRegular,
} from "@fluentui/react-icons";
import { useProjectStore } from "../../store/useProjectStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { PackageManager } from "../../types/project";
import { formatPackageManager } from "../../utils/formatters";
import { useSharedStyles } from "../../styles/useSharedStyles";
import { mergeClasses } from "@fluentui/react-components";
import { RadioGroup, Radio } from "@fluentui/react-components";
import { open, confirm } from "@tauri-apps/plugin-dialog";

const useStyles = makeStyles({
  container: {
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  projectGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))",
    gap: "16px",
  },
  projectCard: {
    padding: "20px",
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: "12px",
    gap: "12px",
  },
  cardHeaderLeft: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    flex: 1,
  },
  packageList: {
    marginTop: "12px",
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
  },
  pathText: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  addForm: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  pathInput: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
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

interface ProjectListProps {
  onNavigate?: (page: any) => void;
}

export const ProjectList: React.FC<ProjectListProps> = ({ onNavigate }) => {
  const styles = useStyles();
  const shared = useSharedStyles();
  const { projects, pendingDeletions, fetchProjects, addProject, removeProject, markForDeletion, undoDeletion, selectProject, loading, autoOpenAddDialog, setAutoOpenAddDialog } =
    useProjectStore();
  const { config } = useSettingsStore();

  const [addProjectDialogOpen, setAddProjectDialogOpen] = useState(false);
  const [pendingProjectPath, setPendingProjectPath] = useState<string | null>(null);
  const [addProjectOnlyCli, setAddProjectOnlyCli] = useState(false);
  const autoOpenHandled = React.useRef(false);
  
  const toasterId = useId("project-toaster");
  const { dispatchToast } = useToastController(toasterId);

  const displayProjects = projects.filter((p) => !pendingDeletions.has(p.id));

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleAddProject = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Project Directory",
        defaultPath: config?.general.projects_directory || undefined,
      });

      if (selected && typeof selected === "string") {
        setPendingProjectPath(selected);
        setAddProjectDialogOpen(true);
      }
    } catch (err) {
      console.error("Failed to select directory:", err);
    }
  };

  useEffect(() => {
    if (autoOpenAddDialog && !autoOpenHandled.current) {
      autoOpenHandled.current = true;
      setAutoOpenAddDialog(false);
      handleAddProject();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenAddDialog, setAutoOpenAddDialog]);

  const getPMBadgeColor = (pm: PackageManager) => {
    switch (pm) {
      case "Npm":
        return "danger" as const;
      case "Yarn":
        return "informative" as const;
      case "Pnpm":
        return "warning" as const;
      default:
        return "important" as const;
    }
  };

  return (
    <div className={styles.container}>
      <Toaster toasterId={toasterId} position="top-end" />
      <div className={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <Title3>Projects</Title3>
          {displayProjects.length > 0 && (
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
              {displayProjects.length} {displayProjects.length === 1 ? "project" : "projects"}
            </Text>
          )}
        </div>
        <Button appearance="primary" icon={<AddRegular />} onClick={handleAddProject}>
          Add Project
        </Button>
      </div>

      {loading && projects.length === 0 ? (
        <div className={styles.projectGrid}>
          {[1, 2, 3].map((i) => (
            <Card key={`skeleton-${i}`} className={styles.projectCard}>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <SkeletonItem shape="rectangle" style={{ width: "60%", height: "24px" }} />
                <SkeletonItem shape="rectangle" style={{ width: "100%", height: "16px" }} />
                <SkeletonItem shape="rectangle" style={{ width: "80%", height: "16px" }} />
                <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                  <SkeletonItem shape="rectangle" style={{ width: "40px", height: "20px", borderRadius: "10px" }} />
                  <SkeletonItem shape="rectangle" style={{ width: "60px", height: "20px", borderRadius: "10px" }} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : displayProjects.length === 0 ? (
        <div className={styles.emptyState}>
          <FolderOpenRegular style={{ fontSize: "48px", color: tokens.colorNeutralForeground3 }} />
          <Title3>No Projects Added</Title3>
          <Text style={{ color: tokens.colorNeutralForeground3 }}>
            Add a project to get started with local package testing
          </Text>
          <Button
            appearance="primary"
            icon={<AddRegular />}
            onClick={handleAddProject}
          >
            Add Your First Project
          </Button>
        </div>
      ) : (
        <div className={styles.projectGrid}>
          {displayProjects.map((project) => (
            <Card 
              key={project.id} 
              className={mergeClasses(shared.card, shared.cardInteractive, styles.projectCard)}
              onClick={() => {
                selectProject(project);
                if (onNavigate) {
                  onNavigate("packages");
                }
              }}
            >
              <div className={styles.cardHeader}>
                <div className={styles.cardHeaderLeft}>
                  <Text 
                    weight="semibold" 
                    size={400} 
                    style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                  >
                    {project.name}
                  </Text>
                  <div className={styles.pathText}>{project.path}</div>
                </div>
                <Button
                  style={{ flexShrink: 0 }}
                  appearance="subtle"
                  icon={<DeleteRegular />}
                  size="small"
                  onClick={async (e) => {
                    e.stopPropagation();
                    const confirmed = await confirm(
                      `Are you sure you want to remove the project "${project.name}"? This will also remove packages and links.`,
                      { title: "Remove Project", kind: "warning" }
                    );
                    if (!confirmed) return;

                    markForDeletion(project.id);

                    dispatchToast(
                      <Toast>
                        <ToastTitle
                          action={
                            <ToastTrigger>
                              <Button
                                appearance="transparent"
                                onClick={() => {
                                  undoDeletion(project.id);
                                }}
                              >
                                Undo
                              </Button>
                            </ToastTrigger>
                          }
                        >
                          Project removed
                        </ToastTitle>
                      </Toast>,
                      { intent: "success" }
                    );
                  }}
                />
              </div>

              <Badge color={getPMBadgeColor(project.package_manager)} appearance="tint">
                {formatPackageManager(project.package_manager)}
              </Badge>

              <div className={styles.packageList}>
                {project.packages.map((pkg) => (
                  <Badge key={pkg.name} appearance="outline" size="small">
                    {pkg.name}@{pkg.version}
                  </Badge>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
      
      <Dialog open={addProjectDialogOpen} onOpenChange={(_, data) => setAddProjectDialogOpen(data.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Add Project Options</DialogTitle>
            <DialogContent>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "12px" }}>
                <Text>How would you like to load packages for this project?</Text>
                <div style={{ 
                  backgroundColor: tokens.colorNeutralBackground1,
                  padding: "12px",
                  borderRadius: "4px",
                  border: `1px solid ${tokens.colorNeutralStroke1}`
                }}>
                  <RadioGroup 
                    value={addProjectOnlyCli ? "cli" : "all"} 
                    onChange={(_, data) => setAddProjectOnlyCli(data.value === "cli")}
                  >
                    <Radio value="all" label="Load all packages" />
                    <Radio value="cli" label="Load only CLI packages" />
                  </RadioGroup>
                </div>
              </div>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => {
                setAddProjectDialogOpen(false);
                setPendingProjectPath(null);
              }}>Cancel</Button>
              <Button appearance="primary" onClick={async () => {
                if (pendingProjectPath) {
                  setAddProjectDialogOpen(false);
                  await addProject(pendingProjectPath, addProjectOnlyCli);
                  setPendingProjectPath(null);
                }
              }}>Add Project</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
};
