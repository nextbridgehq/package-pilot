//! Cross-cutting security regression tests. Each test here maps to a
//! specific threat from review.md §15 (Threat Modeling) — the docstring
//! above each test names which one.

#[cfg(test)]
mod tests {
    use crate::utils::env_filter;
    #[cfg(unix)]
    use crate::utils::safe_path::SafePath;
    use crate::utils::validation::{sanitize_package_name, validate_shell_arg};
    #[cfg(unix)]
    use std::fs;
    #[cfg(unix)]
    use std::path::PathBuf;

    #[cfg(unix)]
    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "pp_security_regression_{}_{}",
            name,
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Threat 2: Path Traversal via Package Name
    #[test]
    fn threat_2_rejects_path_traversal_disguised_as_package_name() {
        assert!(sanitize_package_name("../../../etc/passwd").is_err());
        assert!(sanitize_package_name("@evil/../../.ssh/authorized_keys").is_err());
    }

    /// Threat 3: Symlink Attack in Sandbox — the escaping symlink must not
    /// be followed by safe_remove_all, and its target must survive.
    #[cfg(unix)]
    #[test]
    fn threat_3_symlink_escape_from_sandbox_is_refused() {
        use std::os::unix::fs::symlink;

        let sandbox = temp_dir("threat3_sandbox");
        let victim = temp_dir("threat3_victim");
        fs::write(victim.join("important.txt"), "do not delete").unwrap();
        symlink(&victim, sandbox.join("evil_link")).unwrap();

        let safe = SafePath::new(&sandbox, &sandbox).unwrap();
        let result = safe.safe_remove_all();

        assert!(result.is_err());
        assert!(victim.join("important.txt").exists());

        fs::remove_dir_all(&sandbox).ok();
        fs::remove_dir_all(&victim).unwrap();
    }

    /// Threat 4: Environment Variable Theft via PTY/spawned processes
    #[test]
    fn threat_4_sanitized_env_strips_common_credential_vars() {
        for var in [
            "NPM_TOKEN",
            "GITHUB_TOKEN",
            "AWS_SECRET_ACCESS_KEY",
            "NODE_AUTH_TOKEN",
        ] {
            std::env::set_var(var, "leaked_if_present");
        }

        let env = env_filter::sanitized_env();
        for var in [
            "NPM_TOKEN",
            "GITHUB_TOKEN",
            "AWS_SECRET_ACCESS_KEY",
            "NODE_AUTH_TOKEN",
        ] {
            assert!(
                !env.contains_key(std::ffi::OsStr::new(var)),
                "{} must be stripped from the sanitized environment",
                var
            );
            std::env::remove_var(var);
        }
    }

    /// Vulnerability 1: blocklist-style bypasses that the allowlist must reject.
    #[test]
    fn vuln_1_allowlist_rejects_characters_the_old_blocklist_missed() {
        // These were NOT in the old dangerous_chars blocklist but ARE
        // dangerous: parens/braces (subshell/glob), tilde (home expansion),
        // percent (Windows %VAR% expansion).
        for arg in ["$(echo x)", "foo(bar)", "foo{bar}", "~root", "%NPM_TOKEN%"] {
            assert!(
                validate_shell_arg(arg).is_err(),
                "allowlist should reject: {:?}",
                arg
            );
        }
    }

    /// Vulnerability 7: run_sandbox_script path validation must survive a
    /// symlink planted inside an otherwise-valid-looking sandbox path.
    #[cfg(unix)]
    #[test]
    fn vuln_7_sandbox_script_path_rejects_symlink_escape() {
        use std::os::unix::fs::symlink;

        let sandbox_base = temp_dir("vuln7_base");
        let inside = sandbox_base.join("sandbox_x");
        fs::create_dir_all(&inside).unwrap();
        let outside = temp_dir("vuln7_outside");

        symlink(&outside, inside.join("escape")).unwrap();

        // Constructing a SafePath rooted at the escape target itself must fail,
        // since it doesn't canonicalize to somewhere under sandbox_base.
        let result = SafePath::new(inside.join("escape"), &sandbox_base);
        assert!(result.is_err());

        fs::remove_dir_all(&sandbox_base).unwrap();
        fs::remove_dir_all(&outside).unwrap();
    }
}
