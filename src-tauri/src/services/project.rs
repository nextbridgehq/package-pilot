use crate::models::project::{PackageInfo, PackageManager};
use crate::services::pm_engine::{
    BunEngine, NpmEngine, PackageManagerEngine, PnpmEngine, YarnEngine,
};
use std::fs;
use std::path::{Path, PathBuf};

pub fn detect_pm(path: &Path) -> PackageManager {
    let mut current = Some(path);
    while let Some(p) = current {
        if p.join("pnpm-lock.yaml").exists() {
            return PackageManager::Pnpm;
        } else if p.join("bun.lock").exists() || p.join("bun.lockb").exists() {
            return PackageManager::Bun;
        } else if p.join("yarn.lock").exists() {
            return PackageManager::Yarn;
        } else if p.join("package-lock.json").exists() {
            return PackageManager::Npm;
        }

        if let Ok(content) = std::fs::read_to_string(p.join("package.json")) {
            if let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(pm) = pkg.get("packageManager").and_then(|v| v.as_str()) {
                    let lower = pm.to_lowercase();
                    if lower.starts_with("pnpm") {
                        return PackageManager::Pnpm;
                    } else if lower.starts_with("bun") {
                        return PackageManager::Bun;
                    } else if lower.starts_with("yarn") {
                        return PackageManager::Yarn;
                    } else if lower.starts_with("npm") {
                        return PackageManager::Npm;
                    }
                }
            }
        }
        
        current = p.parent();
    }

    PackageManager::Unknown
}

pub fn resolve_package_manager(
    project_path: &Path,
    configured_default: Option<PackageManager>,
) -> PackageManager {
    let mut current = Some(project_path);
    while let Some(path) = current {
        // Tier 1: Lockfile Detection
        if path.join("pnpm-lock.yaml").exists() {
            return PackageManager::Pnpm;
        }
        if path.join("bun.lock").exists() || path.join("bun.lockb").exists() {
            return PackageManager::Bun;
        }
        if path.join("yarn.lock").exists() {
            return PackageManager::Yarn;
        }
        if path.join("package-lock.json").exists() {
            return PackageManager::Npm;
        }

        // Tier 2: Manifest `packageManager` field
        if let Ok(content) = std::fs::read_to_string(path.join("package.json")) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(pm_str) = json.get("packageManager").and_then(|v| v.as_str()) {
                    let lower = pm_str.to_lowercase();
                    if lower.starts_with("pnpm") {
                        return PackageManager::Pnpm;
                    }
                    if lower.starts_with("bun") {
                        return PackageManager::Bun;
                    }
                    if lower.starts_with("yarn") {
                        return PackageManager::Yarn;
                    }
                    if lower.starts_with("npm") {
                        return PackageManager::Npm;
                    }
                }
            }
        }

        current = path.parent();
    }

    // Tier 3: Configured User Preference
    if let Some(default_pm) = configured_default {
        if default_pm != PackageManager::Unknown {
            return default_pm;
        }
    }

    // Tier 4: Universal Fallback
    PackageManager::Npm
}

pub fn get_engine(pm: PackageManager) -> Box<dyn PackageManagerEngine> {
    match pm {
        PackageManager::Pnpm => Box::new(PnpmEngine),
        PackageManager::Yarn => Box::new(YarnEngine),
        PackageManager::Bun => Box::new(BunEngine),
        _ => Box::new(NpmEngine),
    }
}




pub fn scan_packages(path: &Path, _extra_ignore: &[String]) -> Vec<PackageInfo> {
    let mut packages = Vec::new();
    let mut workspaces = crate::utils::workspace_resolver::resolve_workspaces(path);
    
    // Always ensure the root is scanned if it has a package.json
    if !workspaces.contains(&".".to_string()) {
        workspaces.push(".".to_string());
    }

    let glob_base = dunce::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());

    for glob_str in workspaces {
        let pattern_path = if glob_str == "." {
            glob_base.join("package.json")
        } else {
            glob_base.join(&glob_str).join("package.json")
        };
        let pattern = pattern_path.to_string_lossy().replace("\\", "/");
        
        if let Ok(paths) = glob::glob(&pattern) {
            for entry in paths.filter_map(|e| e.ok()) {
                if let Ok(content) = fs::read_to_string(&entry) {
                    if let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&content) {
                        if pkg.get("name").is_some() {
                            let info = PackageInfo {
                                name: pkg["name"].as_str().unwrap_or("unknown").to_string(),
                                version: pkg
                                    .get("version")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("0.0.0")
                                    .to_string(),
                                path: {
                                    // `glob` matches against a forward-slash pattern (see
                                    // `pattern` above) and reconstructs the result by mixing
                                    // that separator with native ones, e.g.
                                    // "D:/Projects\npm packages\pkg". Re-collecting through
                                    // `components()` normalizes back to the native separator.
                                    let normalized: PathBuf =
                                        entry.parent().unwrap_or(&glob_base).components().collect();
                                    normalized.to_string_lossy().to_string()
                                },
                                is_private: pkg
                                    .get("private")
                                    .and_then(|v| v.as_bool())
                                    .unwrap_or(false),
                                dependencies: extract_deps(&pkg, "dependencies"),
                                dev_dependencies: extract_deps(&pkg, "devDependencies"),
                                peer_dependencies: extract_deps(&pkg, "peerDependencies"),
                                has_cli: pkg.get("bin").is_some(),
                            };
                            
                            // Deduplicate
                            if !packages.iter().any(|p: &PackageInfo| p.path == info.path) {
                                packages.push(info);
                            }
                        }
                    }
                }
            }
        }
    }

    packages
}


pub fn extract_deps(
    pkg: &serde_json::Value,
    field: &str,
) -> Vec<crate::models::project::Dependency> {
    let mut deps = Vec::new();
    if let Some(dep_obj) = pkg[field].as_object() {
        for (name, version) in dep_obj {
            let version_str = version.as_str().unwrap_or("*").to_string();
            let is_local = version_str.starts_with("file:")
                || version_str.starts_with("link:")
                || version_str.starts_with("workspace:");
            deps.push(crate::models::project::Dependency {
                name: name.clone(),
                version: version_str,
                is_local,
            });
        }
    }
    deps
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    #[test]
    fn test_detect_pm() {
        let temp_dir = std::env::temp_dir().join("packlab_test_detect_pm");
        let _ = fs::create_dir_all(&temp_dir);

        // Test npm
        let npm_lock = temp_dir.join("package-lock.json");
        fs::write(&npm_lock, "").unwrap();
        assert_eq!(detect_pm(&temp_dir), PackageManager::Npm);
        fs::remove_file(npm_lock).unwrap();

        // Test yarn
        let yarn_lock = temp_dir.join("yarn.lock");
        fs::write(&yarn_lock, "").unwrap();
        assert_eq!(detect_pm(&temp_dir), PackageManager::Yarn);
        fs::remove_file(yarn_lock).unwrap();

        // Test pnpm
        let pnpm_lock = temp_dir.join("pnpm-lock.yaml");
        fs::write(&pnpm_lock, "").unwrap();
        assert_eq!(detect_pm(&temp_dir), PackageManager::Pnpm);
        fs::remove_file(pnpm_lock).unwrap();

        // Test unknown
        assert_eq!(detect_pm(&temp_dir), PackageManager::Unknown);

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn test_extract_deps() {
        let pkg = json!({
            "dependencies": {
                "react": "^18.0.0",
                "local-lib": "file:../local-lib",
                "workspace-lib": "workspace:*"
            }
        });

        let deps = extract_deps(&pkg, "dependencies");
        assert_eq!(deps.len(), 3);

        let react_dep = deps.iter().find(|d| d.name == "react").unwrap();
        assert_eq!(react_dep.version, "^18.0.0");
        assert!(!react_dep.is_local);

        let local_dep = deps.iter().find(|d| d.name == "local-lib").unwrap();
        assert_eq!(local_dep.version, "file:../local-lib");
        assert!(local_dep.is_local);

        let workspace_dep = deps.iter().find(|d| d.name == "workspace-lib").unwrap();
        assert_eq!(workspace_dep.version, "workspace:*");
        assert!(workspace_dep.is_local);
    }

    #[test]
    fn test_scan_packages() {
        let temp_dir = std::env::temp_dir().join("packlab_test_scan_packages");
        let _ = fs::create_dir_all(&temp_dir);

        let pnpm_workspace = r#"
packages:
  - 'packages/*'
"#;
        fs::write(temp_dir.join("pnpm-workspace.yaml"), pnpm_workspace).unwrap();

        // Root package
        let root_pkg = json!({
            "name": "root-project",
            "version": "1.0.0",
            "private": true
        });
        fs::write(temp_dir.join("package.json"), root_pkg.to_string()).unwrap();

        // Sub package
        let packages_dir = temp_dir.join("packages");
        let sub_dir = packages_dir.join("sub-lib");
        fs::create_dir_all(&sub_dir).unwrap();
        let sub_pkg = json!({
            "name": "sub-lib",
            "version": "0.1.0",
            "bin": { "cli": "index.js" }
        });
        fs::write(sub_dir.join("package.json"), sub_pkg.to_string()).unwrap();

        // Dummy package (should be ignored since it's not in the workspace globs)
        let dummy_dir = temp_dir.join("dummy-lib");
        fs::create_dir_all(&dummy_dir).unwrap();
        let dummy_pkg = json!({
            "name": "dummy-lib",
            "version": "0.1.0"
        });
        fs::write(dummy_dir.join("package.json"), dummy_pkg.to_string()).unwrap();

        let packages = scan_packages(&temp_dir, &[]);
        assert_eq!(packages.len(), 2);

        let root_info = packages.iter().find(|p| p.name == "root-project").unwrap();
        assert!(root_info.is_private);
        assert!(!root_info.has_cli);

        let sub_info = packages.iter().find(|p| p.name == "sub-lib").unwrap();
        assert!(!sub_info.is_private);
        assert!(sub_info.has_cli);
        let expected_path = dunce::canonicalize(&sub_dir).unwrap_or_else(|_| sub_dir.clone());
        let actual_path = dunce::canonicalize(PathBuf::from(&sub_info.path)).unwrap_or_else(|_| PathBuf::from(&sub_info.path));
        assert_eq!(actual_path, expected_path);
        #[cfg(windows)]
        assert!(
            !sub_info.path.contains('/'),
            "package path must use native separators only, got {:?}",
            sub_info.path
        );

        let dummy_info = packages.iter().find(|p| p.name == "dummy-lib");
        assert!(dummy_info.is_none());

        let _ = fs::remove_dir_all(temp_dir);
    }
}

#[cfg(test)]
mod resolution_tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};

    struct TestTempDir {
        path: PathBuf,
    }

    impl TestTempDir {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!("packagepilot_test_{}_{}", name, uuid::Uuid::new_v4()));
            let _ = fs::create_dir_all(&path);
            TestTempDir { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TestTempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn test_resolve_tier_1_lockfiles_bun() {
        let temp = TestTempDir::new("tier1_bun");
        fs::write(temp.path().join("bun.lockb"), "").unwrap();
        assert_eq!(resolve_package_manager(temp.path(), Some(PackageManager::Npm)), PackageManager::Bun);
    }

    #[test]
    fn test_resolve_tier_1_lockfiles_all() {
        let temp = TestTempDir::new("tier1_all");

        fs::write(temp.path().join("pnpm-lock.yaml"), "").unwrap();
        assert_eq!(resolve_package_manager(temp.path(), None), PackageManager::Pnpm);
        fs::remove_file(temp.path().join("pnpm-lock.yaml")).unwrap();

        fs::write(temp.path().join("bun.lock"), "").unwrap();
        assert_eq!(resolve_package_manager(temp.path(), None), PackageManager::Bun);
        fs::remove_file(temp.path().join("bun.lock")).unwrap();

        fs::write(temp.path().join("yarn.lock"), "").unwrap();
        assert_eq!(resolve_package_manager(temp.path(), None), PackageManager::Yarn);
        fs::remove_file(temp.path().join("yarn.lock")).unwrap();

        fs::write(temp.path().join("package-lock.json"), "").unwrap();
        assert_eq!(resolve_package_manager(temp.path(), None), PackageManager::Npm);
        fs::remove_file(temp.path().join("package-lock.json")).unwrap();
    }

    #[test]
    fn test_resolve_tier_2_package_json() {
        let temp = TestTempDir::new("tier2_pkg");
        let pkg = serde_json::json!({ "packageManager": "bun@1.0.0" });
        fs::write(temp.path().join("package.json"), pkg.to_string()).unwrap();
        assert_eq!(resolve_package_manager(temp.path(), Some(PackageManager::Npm)), PackageManager::Bun);
    }

    #[test]
    fn test_resolve_tier_3_configured_default() {
        let temp = TestTempDir::new("tier3_pref");
        assert_eq!(resolve_package_manager(temp.path(), Some(PackageManager::Pnpm)), PackageManager::Pnpm);
    }

    #[test]
    fn test_resolve_tier_4_fallback_npm() {
        let temp = TestTempDir::new("tier4_fallback");
        assert_eq!(resolve_package_manager(temp.path(), None), PackageManager::Npm);
    }

    #[test]
    fn test_get_engine_factory() {
        let engine = get_engine(PackageManager::Pnpm);
        assert_eq!(engine.name(), "pnpm");

        let bun_engine = get_engine(PackageManager::Bun);
        assert_eq!(bun_engine.name(), "bun");

        let yarn_engine = get_engine(PackageManager::Yarn);
        assert_eq!(yarn_engine.name(), "yarn");

        let npm_engine = get_engine(PackageManager::Npm);
        assert_eq!(npm_engine.name(), "npm");
    }
}


