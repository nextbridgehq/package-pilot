use std::path::Path;
use serde::Deserialize;

#[derive(Deserialize)]
struct PnpmWorkspace {
    packages: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct PackageJson {
    workspaces: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct LernaJson {
    packages: Option<Vec<String>>,
}

pub fn resolve_workspaces(root: &Path) -> Vec<String> {
    if let Ok(content) = std::fs::read_to_string(root.join("pnpm-workspace.yaml")) {
        if let Ok(workspace) = serde_yaml::from_str::<PnpmWorkspace>(&content) {
            if let Some(packages) = workspace.packages {
                return packages;
            }
        }
    }

    if let Ok(content) = std::fs::read_to_string(root.join("package.json")) {
        if let Ok(pkg) = serde_json::from_str::<PackageJson>(&content) {
            if let Some(workspaces) = pkg.workspaces {
                return workspaces;
            }
        }
    }

    if let Ok(content) = std::fs::read_to_string(root.join("lerna.json")) {
        if let Ok(lerna) = serde_json::from_str::<LernaJson>(&content) {
            if let Some(packages) = lerna.packages {
                return packages;
            }
        }
    }

    vec![".".to_string()]
}

pub fn detect_workspace_tool(path: &Path) -> crate::models::project::WorkspaceTool {
    if path.join("turbo.json").exists() {
        return crate::models::project::WorkspaceTool::Turbo;
    }
    if path.join("lerna.json").exists() {
        return crate::models::project::WorkspaceTool::Lerna;
    }
    if path.join("pnpm-workspace.yaml").exists() {
        return crate::models::project::WorkspaceTool::Pnpm;
    }

    if let Ok(content) = std::fs::read_to_string(path.join("package.json")) {
        if let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&content) {
            if pkg.get("workspaces").is_some() {
                if path.join("yarn.lock").exists() {
                    return crate::models::project::WorkspaceTool::Yarn;
                }
                return crate::models::project::WorkspaceTool::Npm;
            }
        }
    }

    crate::models::project::WorkspaceTool::None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn test_resolve_pnpm_workspace() {
        let dir = tempdir().unwrap();
        let pnpm_yaml = r#"
packages:
  - 'packages/*'
  - 'apps/*'
"#;
        fs::write(dir.path().join("pnpm-workspace.yaml"), pnpm_yaml).unwrap();
        
        let workspaces = resolve_workspaces(dir.path());
        assert_eq!(workspaces, vec!["packages/*", "apps/*"]);
    }

    #[test]
    fn test_resolve_package_json_workspaces() {
        let dir = tempdir().unwrap();
        let pkg_json = r#"
{
  "workspaces": [
    "components/*",
    "utils/*"
  ]
}
"#;
        fs::write(dir.path().join("package.json"), pkg_json).unwrap();
        
        let workspaces = resolve_workspaces(dir.path());
        assert_eq!(workspaces, vec!["components/*", "utils/*"]);
    }

    #[test]
    fn test_resolve_lerna_json() {
        let dir = tempdir().unwrap();
        let lerna_json = r#"
{
  "packages": [
    "packages/*"
  ]
}
"#;
        fs::write(dir.path().join("lerna.json"), lerna_json).unwrap();
        
        let workspaces = resolve_workspaces(dir.path());
        assert_eq!(workspaces, vec!["packages/*"]);
    }

    #[test]
    fn test_resolve_fallback() {
        let dir = tempdir().unwrap();
        
        let workspaces = resolve_workspaces(dir.path());
        assert_eq!(workspaces, vec!["."]);
    }

    #[test]
    fn test_priority_pnpm_over_package_json() {
        let dir = tempdir().unwrap();
        let pnpm_yaml = r#"
packages:
  - 'pnpm-pkg/*'
"#;
        let pkg_json = r#"
{
  "workspaces": [
    "pkg-json-pkg/*"
  ]
}
"#;
        fs::write(dir.path().join("pnpm-workspace.yaml"), pnpm_yaml).unwrap();
        fs::write(dir.path().join("package.json"), pkg_json).unwrap();
        
        let workspaces = resolve_workspaces(dir.path());
        assert_eq!(workspaces, vec!["pnpm-pkg/*"]);
    }
}
