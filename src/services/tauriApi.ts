import { invoke } from "@tauri-apps/api/core";
import { Project, PackageInfo, LinkEntry, LinkRequest, AppConfig, LogEntry, ScriptInfo, DiagnosticResult, SystemInfo } from "../bindings";
export type { ScriptInfo, DiagnosticResult, SystemInfo, Project, PackageInfo, LinkEntry, LinkRequest, AppConfig, LogEntry };


// Project APIs
export const projectApi = {
  addProject: (path: string, onlyCli: boolean = false) => invoke<Project>("add_project", { path, onlyCli }),
  removeProject: (projectId: string) => invoke<void>("remove_project", { projectId }),
  removePackage: (projectId: string, packageName: string) =>
    invoke<void>("remove_package", { projectId, packageName }),
  listProjects: () => invoke<Project[]>("list_projects"),
  refreshProject: (projectId: string, onlyCli: boolean) =>
    invoke<Project>("refresh_project", { projectId, onlyCli }),
  scanProject: (path: string) => invoke<PackageInfo[]>("scan_project", { path }),
  createSandbox: (packagePath?: string) => invoke<string>("create_sandbox", { packagePath }),
  runSandboxScript: (targetPath: string) => invoke<string>("run_sandbox_script", { targetPath }),
  checkPackageCli: (path: string) => invoke<boolean>("check_package_cli", { path }),
  getPackageScripts: (path: string) => invoke<ScriptInfo[]>("get_package_scripts", { path }),
  npmPackDryRun: (path: string) => invoke<string>("npm_pack_dry_run", { path }),
};

// Link APIs
export const linkApi = {
  createLink: (request: LinkRequest) => invoke<LinkEntry>("create_link", { request }),
  removeLink: (linkId: string) => invoke<void>("remove_link", { linkId }),
  listActiveLinks: () => invoke<LinkEntry[]>("list_active_links"),
  linkViaSymlink: (source: string, target: string) =>
    invoke<string>("link_via_symlink", { source, target }),
  linkViaPack: (source: string, target: string) =>
    invoke<string>("link_via_pack", { source, target }),
  linkViaYalc: (source: string, target: string) =>
    invoke<string>("link_via_yalc", { source, target }),
  linkViaWorkspace: (source: string, target: string) =>
    invoke<string>("link_via_workspace", { source, target }),
  toggleWatch: (linkId: string, enabled: boolean) => invoke("toggle_link_watch", { linkId, enabled }),
  getWatchCommand: (sourcePath: string) => invoke<string | null>("get_watch_command", { sourcePath }),
};

// Watcher APIs
export const watcherApi = {
  startWatching: (linkId: string, path: string) =>
    invoke<void>("start_watching", { linkId, path }),
  stopWatching: (linkId: string) => invoke<void>("stop_watching", { linkId }),
  getWatcherStatus: () => invoke<Record<string, boolean>>("get_watcher_status"),
};

// Build APIs
export const buildApi = {
  runBuild: (path: string, script?: string) =>
    invoke<string>("run_build", { path, script }),
  runInstall: (path: string) => invoke<string>("run_install", { path }),
  getLinkStatus: (id: string) => invoke<LinkEntry>("get_link_status", { id }),
};


// Doctor APIs
export const doctorApi = {
  runDiagnostics: () => invoke<DiagnosticResult[]>("run_diagnostics"),
  checkSymlinkPermissions: () => invoke<DiagnosticResult>("check_symlink_permissions"),
  checkNodeInstallation: () => invoke<DiagnosticResult>("check_node_installation"),
  exportDiagnostics: () => invoke<string>("export_diagnostics"),
};

// Log APIs
export const logApi = {
  getLogs: () => invoke<LogEntry[]>("get_logs"),
  clearLogs: () => invoke<void>("clear_logs"),
};

// Config APIs
export const configApi = {
  getConfig: () => invoke<AppConfig>("get_config"),
  saveConfig: (config: AppConfig) => invoke<void>("save_config", { config }),
};

// Utility APIs
export const utilityApi = {
  openFolderDialog: () => invoke<string | null>("open_folder_dialog"),
  openTerminal: (path: string) => invoke<void>("open_terminal", { path }),
  openInExplorer: (path: string) => invoke<void>("open_in_explorer", { path }),
  getSystemInfo: () => invoke<SystemInfo>("get_system_info"),
  getFilteredEnvVars: () => invoke<string[]>("get_filtered_env_vars"),
};

// PTY APIs
export const ptyApi = {
  spawn: (sessionId: string, directory: string) => invoke("spawn_pty", { sessionId, directory }),
  write: (sessionId: string, data: string) => invoke("write_pty", { sessionId, data }),
  resize: (sessionId: string, rows: number, cols: number) => invoke("resize_pty", { sessionId, rows, cols }),
  kill: (sessionId: string) => invoke("kill_pty", { sessionId }),
  attach: (sessionId: string) => invoke<string | null>("attach_pty", { sessionId }),
};