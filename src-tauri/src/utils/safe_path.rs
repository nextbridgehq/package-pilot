use crate::error::AppError;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

/// A filesystem path that has been proven, at construction time, to live
/// inside an allowed boundary directory after full canonicalization.
///
/// Constructing one is the only way callers get a path they're allowed to
/// recursively delete — see `safe_remove_all`.
#[derive(Debug, Clone)]
pub struct SafePath {
    canonical: PathBuf,
    boundary: PathBuf,
}

impl SafePath {
    /// Resolve `path` and `boundary` to their canonical (symlink-free,
    /// absolute) form and verify `path` sits inside `boundary`. Fails if
    /// either path doesn't exist, or if `path` escapes `boundary`.
    pub fn new(path: impl AsRef<Path>, boundary: impl AsRef<Path>) -> Result<Self, AppError> {
        let boundary = boundary.as_ref();
        let path = path.as_ref();

        let canonical_boundary = std::fs::canonicalize(boundary).map_err(|e| {
            AppError::InvalidPath(format!(
                "Boundary '{}' cannot be resolved: {}",
                boundary.display(),
                e
            ))
        })?;

        let canonical = std::fs::canonicalize(path).map_err(|e| {
            AppError::InvalidPath(format!(
                "Path '{}' cannot be resolved: {}",
                path.display(),
                e
            ))
        })?;

        if !canonical.starts_with(&canonical_boundary) {
            return Err(AppError::InvalidPath(format!(
                "Path '{}' escapes allowed boundary '{}'",
                canonical.display(),
                canonical_boundary.display()
            )));
        }

        Ok(Self {
            canonical,
            boundary: canonical_boundary,
        })
    }

    pub fn as_path(&self) -> &Path {
        &self.canonical
    }

    /// Recursively delete this path. Walks the tree first (without
    /// following symlinks) and refuses if any symlink inside points
    /// outside the boundary — this is what stops a malicious package
    /// from planting `node_modules/evil -> /` and having sandbox
    /// cleanup delete the whole filesystem through it.
    pub fn safe_remove_all(&self) -> Result<(), AppError> {
        if !self.canonical.exists() {
            return Ok(());
        }
        self.verify_no_escaping_symlinks()?;
        std::fs::remove_dir_all(&self.canonical).map_err(|e| {
            AppError::Generic(format!(
                "Failed to remove '{}': {}",
                self.canonical.display(),
                e
            ))
        })
    }

    /// Same as `safe_remove_all` but retries on failure — Windows can hold
    /// a brief file lock after a just-killed process exits.
    pub async fn safe_remove_all_retry(
        &self,
        max_retries: u32,
        delay_ms: u64,
    ) -> Result<(), AppError> {
        if !self.canonical.exists() {
            return Ok(());
        }
        self.verify_no_escaping_symlinks()?;

        let mut last_err = None;
        for attempt in 0..max_retries {
            match std::fs::remove_dir_all(&self.canonical) {
                Ok(()) => return Ok(()),
                Err(e) => {
                    last_err = Some(e);
                    if attempt + 1 < max_retries {
                        tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                    }
                }
            }
        }
        Err(AppError::Generic(format!(
            "Failed to remove '{}' after {} attempts: {}",
            self.canonical.display(),
            max_retries,
            last_err.map(|e| e.to_string()).unwrap_or_default()
        )))
    }

    fn verify_no_escaping_symlinks(&self) -> Result<(), AppError> {
        for entry in WalkDir::new(&self.canonical)
            .follow_links(false)
            .into_iter()
        {
            let entry = entry
                .map_err(|e| AppError::Generic(format!("Failed to walk sandbox tree: {}", e)))?;
            let metadata = entry.path().symlink_metadata().map_err(|e| {
                AppError::Generic(format!(
                    "Cannot read metadata for '{}': {}",
                    entry.path().display(),
                    e
                ))
            })?;

            if !metadata.file_type().is_symlink() {
                continue;
            }

            let target = std::fs::read_link(entry.path()).map_err(|e| {
                AppError::Generic(format!(
                    "Cannot read symlink '{}': {}",
                    entry.path().display(),
                    e
                ))
            })?;
            let resolved = if target.is_absolute() {
                target
            } else {
                entry
                    .path()
                    .parent()
                    .unwrap_or(Path::new("."))
                    .join(&target)
            };

            let canonical_target = match std::fs::canonicalize(&resolved) {
                Ok(c) => c,
                Err(_) => continue, // dangling symlink target — nothing to escape into
            };

            if !canonical_target.starts_with(&self.boundary) {
                return Err(AppError::InvalidPath(format!(
                    "Symlink '{}' points to '{}', outside boundary '{}'. Refusing to remove.",
                    entry.path().display(),
                    canonical_target.display(),
                    self.boundary.display()
                )));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "pp_safe_path_test_{}_{}",
            name,
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn allows_path_within_boundary() {
        let base = temp_dir("within");
        let child = base.join("sub");
        fs::create_dir_all(&child).unwrap();
        assert!(SafePath::new(&child, &base).is_ok());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn rejects_path_outside_boundary() {
        let base = temp_dir("outside_base");
        let outside = temp_dir("outside_target");
        let result = SafePath::new(&outside, &base);
        assert!(result.is_err());
        fs::remove_dir_all(&base).unwrap();
        fs::remove_dir_all(&outside).unwrap();
    }

    #[test]
    fn rejects_traversal_via_dotdot() {
        let base = temp_dir("traversal");
        let child = base.join("sub");
        fs::create_dir_all(&child).unwrap();
        let evil = child.join("..").join("..").join("..");
        assert!(SafePath::new(&evil, &base).is_err());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn safe_remove_all_removes_directory() {
        let base = temp_dir("remove_test");
        let victim = base.join("victim");
        fs::create_dir_all(victim.join("nested")).unwrap();
        fs::write(victim.join("nested/file.txt"), "content").unwrap();

        SafePath::new(&victim, &base)
            .unwrap()
            .safe_remove_all()
            .unwrap();

        assert!(!victim.exists());
        fs::remove_dir_all(&base).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn refuses_to_follow_escaping_symlink() {
        use std::os::unix::fs::symlink;
        let base = temp_dir("symlink_escape");
        let outside = temp_dir("symlink_outside_target");
        let victim = base.join("victim");
        fs::create_dir_all(&victim).unwrap();
        symlink(&outside, victim.join("escape")).unwrap();

        let safe = SafePath::new(&victim, &base).unwrap();
        let result = safe.safe_remove_all();

        assert!(result.is_err());
        assert!(victim.exists(), "victim dir must survive a refused removal");
        assert!(
            outside.exists(),
            "target of the escaping symlink must survive"
        );

        fs::remove_dir_all(&base).unwrap();
        fs::remove_dir_all(&outside).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn allows_symlink_that_stays_within_boundary() {
        use std::os::unix::fs::symlink;
        let base = temp_dir("symlink_internal");
        let real_dir = base.join("real");
        fs::create_dir_all(&real_dir).unwrap();
        symlink(&real_dir, base.join("link")).unwrap();

        let safe = SafePath::new(&base, &base).unwrap();
        assert!(safe.verify_no_escaping_symlinks().is_ok());

        fs::remove_dir_all(&base).unwrap();
    }
}
