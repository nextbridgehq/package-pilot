use crate::models::project::{PackageInfo, PackageManager};
use globset::{Glob, GlobSetBuilder};
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

pub fn detect_pm(path: &Path) -> PackageManager {
    if path.join("pnpm-lock.yaml").exists() {
        return PackageManager::Pnpm;
    } else if path.join("yarn.lock").exists() {
        return PackageManager::Yarn;
    } else if path.join("package-lock.json").exists() {
        return PackageManager::Npm;
    }

    if let Ok(content) = std::fs::read_to_string(path.join("package.json")) {
        if let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(pm) = pkg.get("packageManager").and_then(|v| v.as_str()) {
                if pm.starts_with("pnpm") {
                    return PackageManager::Pnpm;
                } else if pm.starts_with("yarn") {
                    return PackageManager::Yarn;
                } else if pm.starts_with("npm") {
                    return PackageManager::Npm;
                }
            }
        }
    }

    PackageManager::Unknown
}

pub fn scan_packages(path: &Path, extra_ignore: &[String]) -> Vec<PackageInfo> {
    let mut builder = GlobSetBuilder::new();
    let ignore_patterns = vec![
        "node_modules",
        ".git",
        "dist",
        "build",
        "out",
        "coverage",
        "test",
        "tests",
        "__tests__",
        "fixtures",
        "__fixtures__",
        ".next",
        ".nuxt",
        ".svelte-kit",
        "e2e",
        "cypress",
    ];

    for pattern in ignore_patterns {
        if let Ok(glob) = Glob::new(pattern) {
            builder.add(glob);
        }
    }

    for pattern in extra_ignore {
        let mut pat = pattern.clone();
        if !pat.contains('*') && !pat.contains('/') {
            pat = format!("**/{}/**", pat);
        }
        if let Ok(glob) = Glob::new(&pat) {
            builder.add(glob);
        }
    }

    let set = builder.build().unwrap_or_default();

    let mut packages = Vec::new();

    let walker = WalkDir::new(path)
        .max_depth(5)
        .into_iter()
        .filter_entry(|e| {
            let file_name = e.file_name().to_string_lossy();
            !set.is_match(file_name.as_ref())
        });

    for entry in walker.filter_map(|e| e.ok()) {
        if entry.file_name() == "package.json" {
            let entry_path = entry.path();
            if let Ok(content) = fs::read_to_string(entry_path) {
                if let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&content) {
                    if pkg.get("name").is_some() {
                        let info = PackageInfo {
                            name: pkg["name"].as_str().unwrap_or("unknown").to_string(),
                            version: pkg
                                .get("version")
                                .and_then(|v| v.as_str())
                                .unwrap_or("0.0.0")
                                .to_string(),
                            path: entry_path
                                .parent()
                                .unwrap_or(path)
                                .to_string_lossy()
                                .to_string(),
                            is_private: pkg
                                .get("private")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false),
                            dependencies: extract_deps(&pkg, "dependencies"),
                            dev_dependencies: extract_deps(&pkg, "devDependencies"),
                            peer_dependencies: extract_deps(&pkg, "peerDependencies"),
                            has_cli: pkg.get("bin").is_some(),
                        };
                        packages.push(info);
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

        let packages = scan_packages(&temp_dir, &[]);
        assert_eq!(packages.len(), 2);

        let root_info = packages.iter().find(|p| p.name == "root-project").unwrap();
        assert!(root_info.is_private);
        assert!(!root_info.has_cli);

        let sub_info = packages.iter().find(|p| p.name == "sub-lib").unwrap();
        assert!(!sub_info.is_private);
        assert!(sub_info.has_cli);

        let _ = fs::remove_dir_all(temp_dir);
    }
}
