use crate::error::AppError;

/// Allowlist of characters safe to pass as a single argument to
/// `std::process::Command`/`tokio::process::Command`. This is NOT shell
/// interpretation — args here are never passed through `sh -c` or
/// `cmd /c`, so this only needs to stop characters that could be
/// misinterpreted by the *target program* itself (e.g. npm's own argument
/// parsing, or a shell a user explicitly opens via open_terminal).
fn is_safe_arg_char(ch: char) -> bool {
    // Backslash is a path separator on Windows only — review.md names an
    // unconditionally-allowed backslash as a gap on non-Windows, where it
    // has no legitimate path use and should be rejected like any other char.
    if cfg!(windows) && ch == '\\' {
        return true;
    }
    matches!(ch,
        'a'..='z' | 'A'..='Z' | '0'..='9' |
        '/' | '.' | '-' | '_' | ':' | '@' | ' ' |
        '=' | '+' | ','
    )
}

pub fn validate_shell_arg(arg: &str) -> Result<(), AppError> {
    if arg.is_empty() {
        return Ok(()); // empty args are used deliberately (e.g. optional trailing flags)
    }
    if arg.len() > 4096 {
        return Err(AppError::Generic("Command argument too long".to_string()));
    }
    if let Some(ch) = arg.chars().find(|c| !is_safe_arg_char(*c)) {
        return Err(AppError::Generic(format!(
            "Unsafe character '{}' in command argument: {}",
            ch.escape_default(),
            arg
        )));
    }
    Ok(())
}

static PACKAGE_NAME_RE: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| {
    regex::Regex::new(r"^(@[a-z0-9][a-z0-9_.-]*/)?[a-z0-9][a-z0-9_.-]*$").unwrap()
});

pub fn sanitize_package_name(name: &str) -> Result<(), AppError> {
    if name.is_empty() || name.len() > 214 {
        return Err(AppError::InvalidPackageName(format!(
            "Package name must be 1-214 characters, got {}",
            name.len()
        )));
    }
    if name.contains("..") {
        return Err(AppError::InvalidPackageName(
            "Package name cannot contain '..'".to_string(),
        ));
    }
    if !PACKAGE_NAME_RE.is_match(name) {
        return Err(AppError::InvalidPackageName(format!(
            "Invalid package name format: {}",
            name
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shell_arg_allows_safe_values() {
        assert!(validate_shell_arg("react").is_ok());
        assert!(validate_shell_arg("--version").is_ok());
        assert!(validate_shell_arg("@scope/package").is_ok());
        assert!(validate_shell_arg("/usr/local/bin/node").is_ok());
        assert!(validate_shell_arg("C:\\Users\\dev\\project").is_ok());
        assert!(validate_shell_arg("--pack-destination").is_ok());
    }

    #[test]
    fn test_shell_arg_rejects_all_known_injection_vectors() {
        let vectors = [
            "$(cat /etc/passwd)",
            "`cat /etc/passwd`",
            "foo;bar",
            "foo&bar",
            "foo|bar",
            "foo>bar",
            "foo<bar",
            "foo\nbar",
            "foo\rbar",
            "foo(bar)",
            "foo{bar}",
            "foo!bar",
            "foo*bar",
            "foo?bar",
            "foo[bar]",
            "~root",
            "%NPM_TOKEN%",
            "foo#bar",
            "foo^bar",
        ];
        for v in vectors {
            assert!(validate_shell_arg(v).is_err(), "should reject: {:?}", v);
        }
    }

    #[test]
    fn test_shell_arg_rejects_null_byte() {
        assert!(validate_shell_arg("foo\0bar").is_err());
    }

    #[test]
    fn test_package_name_allows_valid_names() {
        assert!(sanitize_package_name("react").is_ok());
        assert!(sanitize_package_name("@types/react").is_ok());
        assert!(sanitize_package_name("my-package_1.0").is_ok());
    }

    #[test]
    fn test_package_name_rejects_traversal() {
        assert!(sanitize_package_name("../../../etc/passwd").is_err());
        assert!(sanitize_package_name("@evil/../../etc").is_err());
        assert!(sanitize_package_name("foo..bar").is_err());
    }

    #[test]
    fn test_package_name_rejects_injection_disguised_as_a_name() {
        assert!(sanitize_package_name("react; rm -rf /").is_err());
        assert!(sanitize_package_name("$(whoami)").is_err());
    }
}
