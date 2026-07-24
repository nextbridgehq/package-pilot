import React, { useEffect, useState } from "react";
import {
  makeStyles,
  tokens,
  Card,
  Title3,
  Text,
  Badge,
  Button,
  SkeletonItem,
  Spinner,
  Toaster,
  useId,
  useToastController,
  Toast,
  ToastTitle,
} from "@fluentui/react-components";
import {
  BoxRegular,
  ArrowSyncRegular,
  OpenRegular,
  DismissRegular,
  DeleteRegular,
  CheckmarkCircleRegular,
  CircleRegular,
} from "@fluentui/react-icons";
import { useProjectStore } from "../../store/useProjectStore";
import { useLinkStore } from "../../store/useLinkStore";
import { PackageManager } from "../../types/project";
import { utilityApi } from "../../services/tauriApi";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useSharedStyles } from "../../styles/useSharedStyles";
import { mergeClasses } from "@fluentui/react-components";
import { Dialog, DialogTrigger, DialogSurface, DialogTitle, DialogBody, DialogContent, DialogActions, RadioGroup, Radio, Checkbox } from "@fluentui/react-components";

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
    flexWrap: "wrap",
    gap: "12px",
  },
  packageGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(400px, 1fr))",
    gap: "16px",
  },
  packageCard: {
    padding: "20px",
    position: "relative",
  },
  packageCardSelected: {
    borderTopColor: tokens.colorStatusDangerBorder1,
    borderRightColor: tokens.colorStatusDangerBorder1,
    borderBottomColor: tokens.colorStatusDangerBorder1,
    borderLeftColor: tokens.colorStatusDangerBorder1,
    backgroundColor: tokens.colorStatusDangerBackground1,
  },
  packageCardSelecting: {
    cursor: "pointer",
  },
  packageCardLinked: {
    cursor: "pointer",
    borderTopColor: tokens.colorBrandStroke1,
    borderRightColor: tokens.colorBrandStroke1,
    borderBottomColor: tokens.colorBrandStroke1,
    borderLeftColor: tokens.colorBrandStroke1,
    borderTopWidth: "2px",
    borderRightWidth: "2px",
    borderBottomWidth: "2px",
    borderLeftWidth: "2px",
  },
  packageCardClickable: {
    cursor: "pointer",
    "&:hover": {
      borderTopColor: tokens.colorBrandStroke1,
      borderRightColor: tokens.colorBrandStroke1,
      borderBottomColor: tokens.colorBrandStroke1,
      borderLeftColor: tokens.colorBrandStroke1,
    },
  },
  selectIcon: {
    position: "absolute",
    top: "16px",
    right: "16px",
    fontSize: "20px",
    zIndex: 1,
  },
  selectionBar: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "10px 16px",
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: "6px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
  },
  packageHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: "12px",
  },
  depsSection: {
    marginTop: "12px",
  },
  depsList: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    marginTop: "8px",
  },
  emptyState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "60px",
    gap: "16px",
  },
  metaInfo: {
    display: "flex",
    gap: "8px",
    marginTop: "8px",
    flexWrap: "wrap",
  },
});

const getPackageManagerName = (pm: PackageManager) => {
  switch (pm) {
    case "Npm": return "npm";
    case "Pnpm": return "pnpm";
    case "Yarn": return "Yarn";
    default: return "Unknown";
  }
};

export interface PackageListProps {
  onNavigate?: (page: "dashboard" | "projects" | "packages" | "links" | "watcher" | "doctor" | "logs" | "settings") => void;
}

export const PackageList: React.FC<PackageListProps> = ({ onNavigate }) => {
  const styles = useStyles();
  const shared = useSharedStyles();
  const { projects, pendingDeletions: projectPendingDeletions, fetchProjects, refreshProject, selectedProject, selectProject, loading, error } = useProjectStore();
  const { activeLinks, fetchLinks } = useLinkStore();
  
  const toasterId = useId("packagelist-toaster");
  const { dispatchToast } = useToastController(toasterId);

  const [refreshDialogOpen, setRefreshDialogOpen] = useState(false);
  const [refreshAllDialogOpen, setRefreshAllDialogOpen] = useState(false);
  const [refreshOnlyCli, setRefreshOnlyCli] = useState(false);
  const [refreshAllOnlyCli, setRefreshAllOnlyCli] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedPkgs, setSelectedPkgs] = useState<Set<string>>(new Set());
  const [removingSelected, setRemovingSelected] = useState(false);

  useEffect(() => {
    fetchProjects();
    fetchLinks();
  }, [fetchProjects, fetchLinks]);

  const projectsToDisplay = selectedProject 
    ? projects.filter(p => p.id === selectedProject.id && !projectPendingDeletions.has(p.id))
    : projects.filter(p => !projectPendingDeletions.has(p.id));

  const totalPackages = projectsToDisplay.reduce((acc, p) => acc + p.packages.length, 0);

  const togglePkgSelection = (key: string) => {
    setSelectedPkgs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedPkgs(new Set());
  };

  const handleRemoveSelected = async () => {
    const count = selectedPkgs.size;
    const confirmed = await confirm(
      `Are you sure you want to remove ${count} selected package${count !== 1 ? "s" : ""}?`,
      { title: "Remove Selected Packages", kind: "warning" }
    );
    if (!confirmed) return;
    setRemovingSelected(true);
    for (const project of projectsToDisplay) {
      for (const pkg of project.packages) {
        const key = `${project.id}:${pkg.name}`;
        if (selectedPkgs.has(key)) {
          try {
            await useProjectStore.getState().removePackage(project.id, pkg.name);
          } catch {
            dispatchToast(
              <Toast><ToastTitle>Failed to remove {pkg.name}</ToastTitle></Toast>,
              { intent: "error" }
            );
          }
        }
      }
    }
    useLinkStore.getState().fetchLinks();
    dispatchToast(
      <Toast><ToastTitle>{count} package{count !== 1 ? "s" : ""} removed</ToastTitle></Toast>,
      { intent: "success" }
    );
    exitSelectMode();
    setRemovingSelected(false);
  };


  return (
    <>
    <Toaster toasterId={toasterId} position="bottom-end" />
    <div className={styles.container}>
      <div className={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <Title3>Packages {selectedProject && `in ${selectedProject.name}`}</Title3>
          {totalPackages > 0 && (
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
              {totalPackages} {totalPackages === 1 ? "package" : "packages"}
            </Text>
          )}
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {selectedProject && (
            <Button
              appearance="secondary"
              icon={<DismissRegular />}
              onClick={() => selectProject(null)}
            >
              Clear Selection
            </Button>
          )}
          {selectedProject ? (
            <Dialog open={refreshDialogOpen} onOpenChange={(_, data) => {
              if (data.open) {
                setRefreshOnlyCli(selectedProject.only_cli ?? false);
              }
              if (!refreshing) setRefreshDialogOpen(data.open);
            }}>
              <DialogTrigger disableButtonEnhancement>
                <Button
                  appearance="subtle"
                  icon={refreshing ? <Spinner size="tiny" /> : <ArrowSyncRegular />}
                  disabled={refreshing}
                >
                  Refresh Project
                </Button>
              </DialogTrigger>
              <DialogSurface>
                <DialogBody>
                  <DialogTitle>Refresh {selectedProject.name}</DialogTitle>
                  <DialogContent>
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "12px" }}>
                      <Text>This will rescan this project for new or updated packages.</Text>
                      <div style={{ 
                        backgroundColor: tokens.colorNeutralBackground1,
                        padding: "12px",
                        borderRadius: "4px",
                        border: `1px solid ${tokens.colorNeutralStroke1}`
                      }}>
                        <RadioGroup 
                          value={refreshOnlyCli ? "cli" : "all"} 
                          onChange={(_, data) => setRefreshOnlyCli(data.value === "cli")}
                        >
                          <Radio value="all" label="Load all packages" />
                          <Radio value="cli" label="Load only CLI packages" />
                        </RadioGroup>
                      </div>
                    </div>
                  </DialogContent>
                  <DialogActions>
                    <DialogTrigger disableButtonEnhancement>
                      <Button appearance="secondary" disabled={refreshing}>Cancel</Button>
                    </DialogTrigger>
                    <Button
                      appearance="primary"
                      disabled={refreshing}
                      icon={refreshing ? <Spinner size="tiny" /> : undefined}
                      onClick={async () => {
                        setRefreshing(true);
                        try {
                          await refreshProject(selectedProject.id, refreshOnlyCli);
                          setRefreshDialogOpen(false);
                          dispatchToast(
                            <Toast><ToastTitle>Packages refreshed for {selectedProject.name}</ToastTitle></Toast>,
                            { intent: "success" }
                          );
                        } finally {
                          setRefreshing(false);
                        }
                      }}
                    >
                      {refreshing ? "Refreshing…" : "Refresh"}
                    </Button>
                  </DialogActions>
                </DialogBody>
              </DialogSurface>
            </Dialog>
          ) : (
            <>
              <Dialog open={refreshAllDialogOpen} onOpenChange={(_, data) => {
                if (!refreshing) setRefreshAllDialogOpen(data.open);
              }}>
                <DialogTrigger disableButtonEnhancement>
                  <Button
                    appearance="subtle"
                    icon={refreshing ? <Spinner size="tiny" /> : <ArrowSyncRegular />}
                    disabled={refreshing}
                  >
                    Refresh All
                  </Button>
                </DialogTrigger>
                <DialogSurface>
                  <DialogBody>
                    <DialogTitle>Refresh All Projects</DialogTitle>
                    <DialogContent>
                      <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "12px" }}>
                        <Text>This will rescan all {projects.length} project{projects.length !== 1 ? "s" : ""} for new or updated packages.</Text>
                        <div style={{ 
                          backgroundColor: tokens.colorNeutralBackground1,
                          padding: "12px",
                          borderRadius: "4px",
                          border: `1px solid ${tokens.colorNeutralStroke1}`
                        }}>
                          <RadioGroup 
                            value={refreshAllOnlyCli ? "cli" : "all"} 
                            onChange={(_, data) => setRefreshAllOnlyCli(data.value === "cli")}
                          >
                            <Radio value="all" label="Load all packages" />
                            <Radio value="cli" label="Load only CLI packages" />
                          </RadioGroup>
                        </div>
                      </div>
                    </DialogContent>
                    <DialogActions>
                      <DialogTrigger disableButtonEnhancement>
                        <Button appearance="secondary" disabled={refreshing}>Cancel</Button>
                      </DialogTrigger>
                      <Button
                        appearance="primary"
                        disabled={refreshing}
                        icon={refreshing ? <Spinner size="tiny" /> : undefined}
                        onClick={async () => {
                          setRefreshing(true);
                          try {
                            // Refresh each project individually so only_cli is applied per project
                            for (const project of projects) {
                              await refreshProject(project.id, refreshAllOnlyCli);
                            }
                            setRefreshAllDialogOpen(false);
                            dispatchToast(
                              <Toast><ToastTitle>All {projects.length} project{projects.length !== 1 ? "s" : ""} refreshed</ToastTitle></Toast>,
                              { intent: "success" }
                            );
                          } finally {
                            setRefreshing(false);
                          }
                        }}
                      >
                        {refreshing ? "Refreshing…" : "Refresh All"}
                      </Button>
                    </DialogActions>
                  </DialogBody>
                </DialogSurface>
              </Dialog>
            </>
          )}
          {totalPackages > 0 && (
            <>
              {!selectMode ? (
                <Button
                  appearance="subtle"
                  icon={<CircleRegular />}
                  onClick={() => setSelectMode(true)}
                >
                  Select
                </Button>
              ) : (
                <Button
                  appearance="subtle"
                  icon={<DismissRegular />}
                  onClick={exitSelectMode}
                >
                  Cancel
                </Button>
              )}
              {selectMode && selectedPkgs.size > 0 && (
                <Button
                  appearance="primary"
                  icon={removingSelected ? <Spinner size="tiny" /> : <DeleteRegular />}
                  disabled={removingSelected}
                  onClick={handleRemoveSelected}
                >
                  Remove Selected ({selectedPkgs.size})
                </Button>
              )}
              {!selectMode && (
                <Button
                  appearance="subtle"
                  icon={<DeleteRegular />}
                  onClick={async () => {
                    const confirmed = await confirm(
                      `Are you sure you want to remove all ${totalPackages} package${totalPackages !== 1 ? "s" : ""}?`,
                      { title: "Remove All Packages", kind: "warning" }
                    );
                    if (confirmed) {
                      for (const project of projectsToDisplay) {
                        for (const pkg of project.packages) {
                          try {
                            await useProjectStore.getState().removePackage(project.id, pkg.name);
                          } catch {
                            dispatchToast(
                              <Toast><ToastTitle>Failed to remove {pkg.name}</ToastTitle></Toast>,
                              { intent: "error" }
                            );
                          }
                        }
                      }
                      useLinkStore.getState().fetchLinks();
                      dispatchToast(
                        <Toast><ToastTitle>All packages removed</ToastTitle></Toast>,
                        { intent: "success" }
                      );
                    }
                  }}
                >
                  Remove All
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {selectMode && totalPackages > 0 && (
        <div className={styles.selectionBar}>
          <Checkbox
            checked={selectedPkgs.size === totalPackages}
            onChange={(_, data) => {
              if (data.checked) {
                const all = new Set<string>();
                projectsToDisplay.forEach((p) =>
                  p.packages.forEach((pkg) => all.add(`${p.id}:${pkg.name}`))
                );
                setSelectedPkgs(all);
              } else {
                setSelectedPkgs(new Set());
              }
            }}
            label="Select All"
          />
          <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
            {selectedPkgs.size} of {totalPackages} selected
          </Text>
        </div>
      )}

      {error && (
        <div style={{ backgroundColor: tokens.colorStatusDangerBackground1, color: tokens.colorStatusDangerForeground1, padding: "12px", borderRadius: "4px", marginBottom: "16px" }}>
          <Text weight="bold">Error loading packages:</Text> {error}
        </div>
      )}

      {loading && totalPackages === 0 ? (
        <div className={styles.packageGrid}>
          {[1, 2, 3, 4].map((i) => (
            <Card key={`skeleton-${i}`} className={shared.card}>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <SkeletonItem shape="rectangle" style={{ width: "50%", height: "24px" }} />
                <SkeletonItem shape="rectangle" style={{ width: "80%", height: "16px" }} />
                <SkeletonItem shape="rectangle" style={{ width: "60%", height: "16px" }} />
                <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                  <SkeletonItem shape="rectangle" style={{ width: "40px", height: "20px", borderRadius: "10px" }} />
                  <SkeletonItem shape="rectangle" style={{ width: "40px", height: "20px", borderRadius: "10px" }} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : totalPackages === 0 ? (
        <Card className={mergeClasses(shared.card, styles.emptyState)}>
          <BoxRegular style={{ fontSize: "48px", color: tokens.colorNeutralForeground3 }} />
          <Title3>No Packages Found</Title3>
          <Text>
            Add projects first to see their packages here.
          </Text>
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
          {projectsToDisplay.map(project => {
            if (project.packages.length === 0) return null;
            return (
              <div key={project.id}>
                <div style={{ marginBottom: "16px", display: "flex", alignItems: "center", gap: "12px" }}>
                  <Text size={500} weight="semibold">{project.name}</Text>
                  <Badge appearance="outline">{project.packages.length} {project.packages.length === 1 ? 'package' : 'packages'}</Badge>
                </div>
                <div className={styles.packageGrid}>
                  {project.packages.map((pkg, index) => {
                    const hasActiveLink = activeLinks.some(l => l.source_package === pkg.name && l.target_path === project.path);
                    const pkgKey = `${project.id}:${pkg.name}`;
                    const isSelected = selectedPkgs.has(pkgKey);
                    return (
                    <Card 
                      key={`${project.name}-${pkg.name}-${index}`} 
                      className={mergeClasses(
                        shared.card,
                        styles.packageCard,
                        !selectMode && styles.packageCardClickable,
                        selectMode && styles.packageCardSelecting,
                        selectMode && isSelected && styles.packageCardSelected,
                        !selectMode && hasActiveLink && styles.packageCardLinked,
                      )}
                      onClick={() => {
                        if (selectMode) {
                          togglePkgSelection(pkgKey);
                        } else if (onNavigate) {
                          useLinkStore.getState().setDraft({ sourcePath: pkg.path });
                          if (hasActiveLink) {
                            useLinkStore.getState().setPendingTab("active");
                          } else {
                            useLinkStore.getState().setPendingTab("create");
                          }
                          onNavigate("links");
                        }
                      }}
                    >
                      {selectMode && (
                        isSelected
                          ? <CheckmarkCircleRegular className={styles.selectIcon} style={{ color: tokens.colorStatusDangerForeground1 }} />
                          : <CircleRegular className={styles.selectIcon} style={{ color: tokens.colorNeutralForeground3 }} />
                      )}
                      <div className={styles.packageHeader}>
                        <div>
                          <Text weight="semibold" size={400}>
                            {pkg.name}
                          </Text>
                          <Badge appearance="tint" style={{ marginLeft: "8px" }}>
                            v{pkg.version}
                          </Badge>
                        </div>
                        <div style={{ display: "flex", gap: "4px", visibility: selectMode ? "hidden" : "visible" }}>
                          <Button 
                            icon={<OpenRegular />} 
                            size="small" 
                            appearance="subtle"
                            title="Open folder in File Explorer"
                            onClick={(e) => {
                              e.stopPropagation();
                              utilityApi.openInExplorer(pkg.path);
                            }} 
                          />
                          <Button 
                            icon={<DeleteRegular />} 
                            size="small"
                            appearance="subtle"
                            title="Remove package from project"
                            onClick={async (e) => {
                              e.stopPropagation();
                              const confirmed = await confirm(`Are you sure you want to remove ${pkg.name} from this project?`, {
                                title: "Remove Package",
                                kind: "warning",
                              });
                              if (confirmed) {
                                try {
                                  await useProjectStore.getState().removePackage(project.id, pkg.name);
                                  useLinkStore.getState().fetchLinks();
                                } catch {
                                  dispatchToast(
                                    <Toast><ToastTitle>Failed to remove {pkg.name}</ToastTitle></Toast>,
                                    { intent: "error" }
                                  );
                                }
                              }
                            }} 
                          />
                        </div>
                      </div>

                      <div className={styles.metaInfo}>
                        <Badge color="informative" appearance="tint">
                          {getPackageManagerName(project.package_manager)}
                        </Badge>
                        {pkg.is_private && (
                          <Badge color="danger" appearance="tint">
                            Private
                          </Badge>
                        )}
                      </div>

                      <div className={styles.depsSection}>
                        {pkg.dependencies.length === 0 && pkg.dev_dependencies.length === 0 && pkg.peer_dependencies.length === 0 && (
                          <Text size={300} style={{ color: tokens.colorNeutralForeground3, fontStyle: "italic" }}>
                            No dependencies
                          </Text>
                        )}

                        {pkg.dependencies.length > 0 && (
                          <div>
                            <Text weight="semibold" size={300}>
                              Dependencies ({pkg.dependencies.length})
                            </Text>
                            <div className={styles.depsList}>
                              {pkg.dependencies.map((dep) => (
                                <Badge key={dep.name} appearance="outline" size="small">
                                  {dep.name}@{dep.version}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}

                        {pkg.dev_dependencies.length > 0 && (
                          <div style={{ marginTop: "12px" }}>
                            <Text weight="semibold" size={300}>
                              Dev Dependencies ({pkg.dev_dependencies.length})
                            </Text>
                            <div className={styles.depsList}>
                              {pkg.dev_dependencies.map((dep) => (
                                <Badge key={dep.name} appearance="outline" size="small">
                                  {dep.name}@{dep.version}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}

                        {pkg.peer_dependencies.length > 0 && (
                          <div style={{ marginTop: "12px" }}>
                            <Text weight="semibold" size={300}>
                              Peer Dependencies ({pkg.peer_dependencies.length})
                            </Text>
                            <div className={styles.depsList}>
                              {pkg.peer_dependencies.map((dep) => (
                                <Badge key={dep.name} appearance="outline" size="small">
                                  {dep.name}@{dep.version}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
    </>
  );
};
