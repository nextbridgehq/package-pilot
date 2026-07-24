use crate::error::AppError;
use crate::models::link::{LinkEntry, LinkMethod, LinkRequest, LinkStatus};
use crate::services::shell::run_command;
use std::path::Path;
use tokio::time::Duration;

pub async fn link_via_symlink_internal(request: &LinkRequest) -> Result<LinkEntry, AppError> {
    let source_path = Path::new(&request.source_path);

    // Read source package name
    let source_pkg_json = std::fs::read_to_string(source_path.join("package.json"))
        .map_err(|e| AppError::Generic(format!("Cannot read source package.json: {}", e)))?;
    let source_pkg: serde_json::Value = serde_json::from_str(&source_pkg_json)
        .map_err(|e| AppError::Generic(format!("Cannot parse source package.json: {}", e)))?;
    let package_name = source_pkg["name"].as_str().unwrap_or("unknown").to_string();
    crate::utils::validation::sanitize_package_name(&package_name)?;

    // Build first if requested
    if request.build_first {
        run_build_if_exists(&request.source_path).await?;
    }

    // SECURITY: --ignore-scripts unless the user explicitly opted in via config.
    // Step 1: npm link in source directory
    let mut source_link_args = vec!["link"];
    if !request.allow_lifecycle_scripts {
        source_link_args.push("--ignore-scripts");
    }
    run_command(
        "npm",
        &source_link_args,
        &request.source_path,
        Duration::from_secs(60),
    )
    .await?;

    // Step 2: npm link <package-name> in target directory
    let mut target_link_args = vec!["link", package_name.as_str()];
    if !request.allow_lifecycle_scripts {
        target_link_args.push("--ignore-scripts");
    }
    run_command(
        "npm",
        &target_link_args,
        &request.target_path,
        Duration::from_secs(60),
    )
    .await?;

    Ok(LinkEntry {
        id: uuid::Uuid::new_v4().to_string(),
        source_package: package_name,
        source_path: request.source_path.clone(),
        target_project: get_package_name(&request.target_path).unwrap_or_default(),
        target_path: request.target_path.clone(),
        method: LinkMethod::Symlink,
        status: LinkStatus::Active,
        watch_enabled: request.watch,
        created_at: chrono::Utc::now(),
        last_synced: Some(chrono::Utc::now()),
        has_cli: false,
    })
}

pub async fn link_via_pack_internal(request: &LinkRequest) -> Result<LinkEntry, AppError> {
    let package_name = get_package_name(&request.source_path).unwrap_or_default();
    crate::utils::validation::sanitize_package_name(&package_name)?;

    if request.build_first {
        run_build_if_exists(&request.source_path).await?;
    }

    // SECURITY: --ignore-scripts unless the user explicitly opted in via config.
    // `npm pack` runs the SOURCE package's own prepack/postpack/prepare
    // scripts before the tarball is even produced, so this call must be
    // gated too -- not just the subsequent install.
    let mut pack_args = vec!["pack", "--pack-destination", request.target_path.as_str()];
    if !request.allow_lifecycle_scripts {
        pack_args.push("--ignore-scripts");
    }
    let stdout = run_command(
        "npm",
        &pack_args,
        &request.source_path,
        Duration::from_secs(300),
    )
    .await?;

    // npm pack prints the tarball name on the last line.
    // If lifecycle scripts are run, they will print before the tarball name.
    let tarball_name = stdout
        .lines()
        .rfind(|l| !l.trim().is_empty())
        .unwrap_or("")
        .trim()
        .to_string();
    let tarball_path = Path::new(&request.target_path).join(&tarball_name);
    let tarball_path_str = tarball_path.to_string_lossy().to_string();

    let mut install_args: Vec<&str> = vec![
        "install",
        &tarball_path_str,
        "--no-save",
        "--legacy-peer-deps",
    ];
    if !request.allow_lifecycle_scripts {
        install_args.push("--ignore-scripts");
    }
    run_command(
        "npm",
        &install_args,
        &request.target_path,
        Duration::from_secs(300),
    )
    .await?;

    Ok(LinkEntry {
        id: uuid::Uuid::new_v4().to_string(),
        source_package: package_name,
        source_path: request.source_path.clone(),
        target_project: get_package_name(&request.target_path).unwrap_or_default(),
        target_path: request.target_path.clone(),
        method: LinkMethod::NpmPack,
        status: LinkStatus::Active,
        watch_enabled: request.watch,
        created_at: chrono::Utc::now(),
        last_synced: Some(chrono::Utc::now()),
        has_cli: false,
    })
}

pub async fn link_via_yalc_internal(request: &LinkRequest) -> Result<LinkEntry, AppError> {
    let package_name = get_package_name(&request.source_path).unwrap_or_default();
    crate::utils::validation::sanitize_package_name(&package_name)?;

    if request.build_first {
        run_build_if_exists(&request.source_path).await?;
    }

    // SECURITY: yalc has no --ignore-scripts equivalent (it always runs
    // prepare/prepack via its internal `npm pack` call). The script-preview
    // panel (Task 8) is this method's only mitigation until yalc adds one.
    run_command(
        "yalc",
        &["publish"],
        &request.source_path,
        Duration::from_secs(60),
    )
    .await?;
    run_command(
        "yalc",
        &["add", &package_name],
        &request.target_path,
        Duration::from_secs(60),
    )
    .await?;

    Ok(LinkEntry {
        id: uuid::Uuid::new_v4().to_string(),
        source_package: package_name,
        source_path: request.source_path.clone(),
        target_project: get_package_name(&request.target_path).unwrap_or_default(),
        target_path: request.target_path.clone(),
        method: LinkMethod::Yalc,
        status: LinkStatus::Active,
        watch_enabled: request.watch,
        created_at: chrono::Utc::now(),
        last_synced: Some(chrono::Utc::now()),
        has_cli: false,
    })
}

pub async fn link_via_workspace_internal(request: &LinkRequest) -> Result<LinkEntry, AppError> {
    let package_name = get_package_name(&request.source_path).unwrap_or_default();
    crate::utils::validation::sanitize_package_name(&package_name)?;
    let target_pkg_json_path = Path::new(&request.target_path).join("package.json");

    let content = std::fs::read_to_string(&target_pkg_json_path)
        .map_err(|e| AppError::Generic(format!("Cannot read target package.json: {}", e)))?;
    let mut pkg: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| AppError::Generic(format!("Cannot parse target package.json: {}", e)))?;

    let relative_path = pathdiff::diff_paths(&request.source_path, &request.target_path)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| request.source_path.clone());

    if !pkg
        .get("dependencies")
        .map(|d| d.is_object())
        .unwrap_or(false)
    {
        pkg["dependencies"] = serde_json::json!({});
    }

    if let Some(deps) = pkg["dependencies"].as_object_mut() {
        deps.insert(
            package_name.clone(),
            serde_json::Value::String(format!("file:{}", relative_path)),
        );
    }

    let updated_content = serde_json::to_string_pretty(&pkg)
        .map_err(|e| AppError::Generic(format!("Failed to serialize package.json: {}", e)))?;
    std::fs::write(&target_pkg_json_path, updated_content)
        .map_err(|e| AppError::Generic(format!("Failed to write package.json: {}", e)))?;

    // SECURITY: --ignore-scripts unless the user explicitly opted in via config.
    let mut install_args = vec!["install", "--legacy-peer-deps"];
    if !request.allow_lifecycle_scripts {
        install_args.push("--ignore-scripts");
    }
    run_command(
        "npm",
        &install_args,
        &request.target_path,
        Duration::from_secs(300),
    )
    .await?;

    Ok(LinkEntry {
        id: uuid::Uuid::new_v4().to_string(),
        source_package: package_name,
        source_path: request.source_path.clone(),
        target_project: get_package_name(&request.target_path).unwrap_or_default(),
        target_path: request.target_path.clone(),
        method: LinkMethod::Workspace,
        status: LinkStatus::Active,
        watch_enabled: request.watch,
        created_at: chrono::Utc::now(),
        last_synced: Some(chrono::Utc::now()),
        has_cli: false,
    })
}

pub async fn link_via_file_copy_internal(request: &LinkRequest) -> Result<LinkEntry, AppError> {
    let package_name = get_package_name(&request.source_path).unwrap_or_default();
    crate::utils::validation::sanitize_package_name(&package_name)?;
    let target_node_modules = Path::new(&request.target_path)
        .join("node_modules")
        .join(&package_name);

    if target_node_modules.exists() {
        std::fs::remove_dir_all(&target_node_modules)
            .map_err(|e| AppError::Generic(format!("Failed to remove existing: {}", e)))?;
    }

    copy_dir_recursive(Path::new(&request.source_path), &target_node_modules)?;

    Ok(LinkEntry {
        id: uuid::Uuid::new_v4().to_string(),
        source_package: package_name,
        source_path: request.source_path.clone(),
        target_project: get_package_name(&request.target_path).unwrap_or_default(),
        target_path: request.target_path.clone(),
        method: LinkMethod::FileCopy,
        status: LinkStatus::Active,
        watch_enabled: request.watch,
        created_at: chrono::Utc::now(),
        last_synced: Some(chrono::Utc::now()),
        has_cli: false,
    })
}

pub async fn unlink_symlink(link: &LinkEntry) -> Result<(), AppError> {
    run_command(
        "npm",
        &["unlink", &link.source_package],
        &link.target_path,
        Duration::from_secs(60),
    )
    .await?;
    run_command(
        "npm",
        &["unlink"],
        &link.source_path,
        Duration::from_secs(60),
    )
    .await?;
    Ok(())
}

pub async fn unlink_pack(link: &LinkEntry) -> Result<(), AppError> {
    run_command(
        "npm",
        &["uninstall", &link.source_package],
        &link.target_path,
        Duration::from_secs(60),
    )
    .await?;
    Ok(())
}

pub async fn unlink_yalc(link: &LinkEntry) -> Result<(), AppError> {
    run_command(
        "yalc",
        &["remove", &link.source_package],
        &link.target_path,
        Duration::from_secs(60),
    )
    .await?;
    Ok(())
}

pub async fn run_build_if_exists(source_path: &str) -> Result<(), AppError> {
    let pkg_json_path = Path::new(source_path).join("package.json");
    if let Ok(content) = std::fs::read_to_string(pkg_json_path) {
        if let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(scripts) = pkg.get("scripts").and_then(|s| s.as_object()) {
                if scripts.contains_key("build") {
                    run_command(
                        "npm",
                        &["run", "build"],
                        source_path,
                        Duration::from_secs(300),
                    )
                    .await?;
                }
            }
        }
    }
    Ok(())
}

pub fn get_package_name(path: &str) -> Option<String> {
    let pkg_json_path = Path::new(path).join("package.json");
    let content = std::fs::read_to_string(pkg_json_path).ok()?;
    let pkg: serde_json::Value = serde_json::from_str(&content).ok()?;
    pkg["name"].as_str().map(|s| s.to_string())
}

pub fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), AppError> {
    std::fs::create_dir_all(dst).map_err(|e| AppError::Generic(e.to_string()))?;

    for entry in walkdir::WalkDir::new(src)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            !e.path_is_symlink()
                && !e
                    .path()
                    .components()
                    .any(|c| c.as_os_str() == "node_modules" || c.as_os_str() == ".git")
        })
    {
        let entry = entry.map_err(|e| AppError::Generic(e.to_string()))?;
        let relative = entry
            .path()
            .strip_prefix(src)
            .map_err(|e| AppError::Generic(e.to_string()))?;
        let target = dst.join(relative);

        if entry.path().is_dir() {
            std::fs::create_dir_all(&target).map_err(|e| AppError::Generic(e.to_string()))?;
        } else {
            std::fs::copy(entry.path(), &target).map_err(|e| AppError::Generic(e.to_string()))?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "packlab_test_{}_{}",
            name,
            chrono::Utc::now().timestamp_micros()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn get_package_name_reads_name_field() {
        let dir = temp_dir("get_pkg_name");
        fs::write(
            dir.join("package.json"),
            r#"{"name": "my-pkg", "version": "1.0.0"}"#,
        )
        .unwrap();

        assert_eq!(
            get_package_name(dir.to_str().unwrap()),
            Some("my-pkg".to_string())
        );

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn get_package_name_returns_none_without_package_json() {
        let dir = temp_dir("get_pkg_name_missing");
        assert_eq!(get_package_name(dir.to_str().unwrap()), None);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn copy_dir_recursive_copies_files_and_skips_node_modules() {
        let src = temp_dir("copy_src");
        let dst = temp_dir("copy_dst");
        fs::remove_dir_all(&dst).unwrap(); // copy_dir_recursive creates it

        fs::write(src.join("index.js"), "module.exports = {};").unwrap();
        fs::create_dir_all(src.join("node_modules/dep")).unwrap();
        fs::write(src.join("node_modules/dep/pkg.json"), "{}").unwrap();
        fs::create_dir_all(src.join("lib")).unwrap();
        fs::write(src.join("lib/util.js"), "// util").unwrap();

        copy_dir_recursive(&src, &dst).unwrap();

        assert!(dst.join("index.js").exists());
        assert!(dst.join("lib/util.js").exists());
        assert!(!dst.join("node_modules").exists());

        fs::remove_dir_all(&src).unwrap();
        fs::remove_dir_all(&dst).unwrap();
    }

    #[tokio::test]
    async fn run_build_if_exists_is_noop_without_build_script() {
        let dir = temp_dir("no_build_script");
        fs::write(
            dir.join("package.json"),
            r#"{"name": "x", "scripts": {"test": "echo hi"}}"#,
        )
        .unwrap();

        let result = run_build_if_exists(dir.to_str().unwrap()).await;

        assert!(result.is_ok());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[tokio::test]
    async fn run_build_if_exists_is_noop_without_package_json() {
        let dir = temp_dir("no_package_json");
        let result = run_build_if_exists(dir.to_str().unwrap()).await;
        assert!(result.is_ok());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[tokio::test]
    async fn link_via_symlink_does_not_run_postinstall_by_default() {
        let source = temp_dir("script_source");
        let marker = source.join("PWNED.txt");
        // NOTE: deviates from the brief's exact escaping. The brief only escaped
        // backslashes for the JSON layer (package.json is JSON), but the path is
        // then embedded inside a single-quoted JS string literal that `node -e`
        // evaluates — JS itself treats backslash as an escape character, so a
        // raw Windows path's backslashes get silently stripped by V8 before
        // fs.writeFileSync ever sees them (confirmed via manual repro: it throws
        // EPERM on a mangled/concatenated path). Node accepts forward slashes
        // in paths on Windows, so using them here sidesteps both the JSON and
        // JS escaping layers entirely and lets the test genuinely exercise
        // whether the postinstall script ran.
        let marker_js_path = marker.to_string_lossy().replace('\\', "/");
        fs::write(
            source.join("package.json"),
            format!(
                r#"{{"name":"script-test-pkg","version":"1.0.0","scripts":{{"postinstall":"node -e \"require('fs').writeFileSync('{}', 'pwned')\""}}}}"#,
                marker_js_path
            ),
        )
        .unwrap();

        let target = temp_dir("script_target");
        fs::write(
            target.join("package.json"),
            r#"{"name":"target-pkg","version":"1.0.0"}"#,
        )
        .unwrap();

        let request = LinkRequest {
            source_path: source.to_string_lossy().to_string(),
            target_path: target.to_string_lossy().to_string(),
            method: LinkMethod::Symlink,
            watch: false,
            build_first: false,
            install_peer_deps: false,
            allow_lifecycle_scripts: false,
        };

        let _ = link_via_symlink_internal(&request).await;

        assert!(
            !marker.exists(),
            "postinstall script must NOT have run when allow_lifecycle_scripts is false"
        );

        fs::remove_dir_all(&source).unwrap();
        fs::remove_dir_all(&target).unwrap();
    }

    #[tokio::test]
    async fn link_via_pack_does_not_run_prepack_by_default() {
        // Regression test for a gap the reviewer caught: `npm pack` runs the
        // SOURCE package's own prepack/postpack/prepare scripts *before* the
        // tarball is produced, independent of the later `npm install`. Gating
        // only the install call left this method's own pack step unprotected.
        let source = temp_dir("pack_script_source");
        let marker = source.join("PWNED_PACK.txt");
        // Forward slashes, same reasoning as the symlink test above: avoids
        // JS-string-escape mangling of Windows backslashes inside `node -e`.
        let marker_js_path = marker.to_string_lossy().replace('\\', "/");
        fs::write(
            source.join("package.json"),
            format!(
                r#"{{"name":"pack-script-test-pkg","version":"1.0.0","scripts":{{"prepack":"node -e \"require('fs').writeFileSync('{}', 'pwned')\""}}}}"#,
                marker_js_path
            ),
        )
        .unwrap();

        let target = temp_dir("pack_script_target");
        fs::write(
            target.join("package.json"),
            r#"{"name":"target-pkg","version":"1.0.0"}"#,
        )
        .unwrap();

        let request = LinkRequest {
            source_path: source.to_string_lossy().to_string(),
            target_path: target.to_string_lossy().to_string(),
            method: LinkMethod::NpmPack,
            watch: false,
            build_first: false,
            install_peer_deps: false,
            allow_lifecycle_scripts: false,
        };

        let _ = link_via_pack_internal(&request).await;

        assert!(
            !marker.exists(),
            "prepack script must NOT have run when allow_lifecycle_scripts is false"
        );

        fs::remove_dir_all(&source).unwrap();
        fs::remove_dir_all(&target).unwrap();
    }
}
