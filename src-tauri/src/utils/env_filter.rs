use std::collections::HashMap;
use std::ffi::OsString;

/// Substrings that mark a variable as a credential/secret. Matched
/// case-insensitively anywhere in the variable name (not just as a
/// prefix — e.g. `MY_API_KEY_BACKUP` must still be caught).
const SENSITIVE_PREFIXES: &[&str] = &[
    "NPM_TOKEN",
    "NODE_AUTH_TOKEN",
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "GITLAB_TOKEN",
    "AWS_SECRET",
    "AWS_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AZURE_",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GCP_",
    "DOCKER_",
    "REGISTRY_TOKEN",
    "PUBLISH_TOKEN",
    "SSH_AUTH_SOCK",
    "GPG_",
    "SIGNING_",
    "SECRET",
    "PASSWORD",
    "CREDENTIAL",
    "PRIVATE_KEY",
    "API_KEY",
    "AUTH_TOKEN",
    "CARGO_REGISTRY_TOKEN",
    "PYPI_TOKEN",
    "SNYK_TOKEN",
    "SENTRY_",
    "SLACK_TOKEN",
    "DISCORD_TOKEN",
    "VERCEL_TOKEN",
    "NETLIFY_AUTH_TOKEN",
    "CLOUDFLARE_API_TOKEN",
    "DIGITALOCEAN_ACCESS_TOKEN",
    "HEROKU_API_KEY",
];

/// Variables that must survive filtering for the shell / node / npm to work at all.
const REQUIRED_VARS: &[&str] = &[
    "PATH",
    "HOME",
    "USER",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "TEMP",
    "TMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "TERM",
    "SHELL",
    "COMSPEC",
    "SystemRoot",
    "windir",
    "APPDATA",
    "LOCALAPPDATA",
    "ProgramFiles",
    "ProgramFiles(x86)",
    "CommonProgramFiles",
    "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
    "OS",
    "NODE_PATH",
    "NVM_DIR",
    "NVM_HOME",
    "FNM_DIR",
    "VOLTA_HOME",
];

/// True if `key` should be stripped before handing the environment to a
/// spawned npm/node/PTY process. Required vars always win over a substring
/// match so PATH-like names never get caught by an overly broad marker.
pub fn is_sensitive(key: &str) -> bool {
    let upper = key.to_uppercase();
    if REQUIRED_VARS.iter().any(|r| upper == r.to_uppercase()) {
        return false;
    }
    SENSITIVE_PREFIXES
        .iter()
        .any(|prefix| upper.contains(&prefix.to_uppercase()))
}

/// The current process environment with sensitive variables removed.
pub fn sanitized_env() -> HashMap<OsString, OsString> {
    std::env::vars_os()
        .filter(|(key, _)| !is_sensitive(&key.to_string_lossy()))
        .collect()
}

/// Names of variables that `sanitized_env` would strip out of the *current*
/// process environment — for display in a "what we hide" settings panel.
/// Uses `vars_os` + lossy conversion (matching `sanitized_env`) rather than
/// `std::env::vars`, which panics on non-Unicode content — a real
/// occurrence on Windows with third-party tools.
pub fn filtered_variable_names() -> Vec<String> {
    std::env::vars_os()
        .filter(|(key, _)| is_sensitive(&key.to_string_lossy()))
        .map(|(key, _)| key.to_string_lossy().to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_npm_and_github_tokens() {
        assert!(is_sensitive("NPM_TOKEN"));
        assert!(is_sensitive("npm_token"));
        assert!(is_sensitive("GITHUB_TOKEN"));
        assert!(is_sensitive("GH_TOKEN"));
    }

    #[test]
    fn filters_aws_credentials() {
        assert!(is_sensitive("AWS_SECRET_ACCESS_KEY"));
        assert!(is_sensitive("AWS_ACCESS_KEY_ID"));
        assert!(is_sensitive("AWS_SESSION_TOKEN"));
    }

    #[test]
    fn filters_generic_secret_patterns() {
        assert!(is_sensitive("MY_API_KEY"));
        assert!(is_sensitive("SECRET_SAUCE"));
        assert!(is_sensitive("PRIVATE_KEY_PATH"));
    }

    #[test]
    fn preserves_required_vars() {
        assert!(!is_sensitive("PATH"));
        assert!(!is_sensitive("HOME"));
        assert!(!is_sensitive("USERPROFILE"));
        assert!(!is_sensitive("SystemRoot"));
    }

    #[test]
    fn sanitized_env_excludes_secret_but_keeps_path() {
        std::env::set_var("NPM_TOKEN", "super_secret");
        let env = sanitized_env();
        assert!(!env.contains_key(std::ffi::OsStr::new("NPM_TOKEN")));
        let has_path = env
            .keys()
            .any(|k| k.to_string_lossy().eq_ignore_ascii_case("PATH"));
        assert!(has_path, "PATH must survive sanitization");
        std::env::remove_var("NPM_TOKEN");
    }

    #[test]
    fn filtered_variable_names_reports_what_was_hidden() {
        std::env::set_var("GITHUB_TOKEN", "ghp_fake");
        let names = filtered_variable_names();
        assert!(names.iter().any(|n| n == "GITHUB_TOKEN"));
        std::env::remove_var("GITHUB_TOKEN");
    }
}
