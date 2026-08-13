use crate::commands::cmd_name;
use crate::state::app_state::{AppState, LockExt};
use crate::utils::env_filter;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{Emitter, Manager, State};

/// Applies the same secret-stripping environment policy used for every other
/// spawned process in this codebase (PTY shells, npm/link operations) to a
/// verdaccio command. Verdaccio is a long-running local HTTP server, unlike
/// the short-lived `--version` probe, so it has no need to inherit tokens
/// like NPM_TOKEN/GITHUB_TOKEN from the app's own environment.
fn sanitize_command_env(cmd: &mut tokio::process::Command) {
    cmd.env_clear();
    for (key, value) in env_filter::sanitized_env() {
        cmd.env(key, value);
    }
}

/// Extracts the port from a `http://host:port` registry URL, defaulting to
/// verdaccio's own default (4873) if the URL is missing or malformed - every
/// caller in this codebase only ever points this at a local verdaccio
/// instance, so host is always 127.0.0.1/localhost and only the port varies.
fn extract_port(url: &str) -> u16 {
    url.rsplit(':')
        .next()
        .map(|s| s.trim_end_matches('/'))
        .and_then(|s| s.parse().ok())
        .unwrap_or(4873)
}

/// Polls `127.0.0.1:port` until a TCP connection succeeds or `timeout`
/// elapses. `start_registry` fires off verdaccio in a detached background
/// task and used to return success the instant that task was scheduled -
/// before verdaccio had actually bound the port - so a caller that
/// immediately tried to publish could hit connection-refused. This makes
/// the command's success genuinely mean "ready to accept connections".
async fn wait_for_registry_ready(port: u16, timeout: Duration) -> bool {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        if tokio::net::TcpStream::connect(("127.0.0.1", port)).await.is_ok() {
            return true;
        }
        if tokio::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

/// Resolves the user-configured storage path against `data_dir` (relative
/// paths, including the "./local-registry" default, aren't relative to
/// anything meaningful otherwise - verdaccio's own cwd isn't controlled by
/// us), then writes a minimal verdaccio config pointing at it so the
/// "Storage Path" setting actually takes effect instead of being silently
/// ignored in favor of verdaccio's built-in default storage location.
fn write_verdaccio_config(data_dir: &Path, storage_path: &str) -> std::io::Result<PathBuf> {
    let resolved_storage: PathBuf = {
        let p = Path::new(storage_path);
        let joined = if p.is_absolute() { p.to_path_buf() } else { data_dir.join(p) };
        // Collapse "./"/redundant separators (e.g. the "./local-registry"
        // default) so the stored path doesn't carry a literal "." component.
        joined.components().collect()
    };
    std::fs::create_dir_all(&resolved_storage)?;

    let verdaccio_dir = data_dir.join("verdaccio");
    std::fs::create_dir_all(&verdaccio_dir)?;

    // Forward slashes are valid path separators in verdaccio's own config
    // parsing on Windows too, and sidestep YAML backslash-escaping entirely.
    let storage_yaml = resolved_storage.to_string_lossy().replace('\\', "/");
    let htpasswd_yaml = verdaccio_dir.join("htpasswd").to_string_lossy().replace('\\', "/");

    let config = format!(
        "storage: {storage_yaml}\n\
auth:\n\
\x20\x20htpasswd:\n\
\x20\x20\x20\x20file: {htpasswd_yaml}\n\
uplinks:\n\
\x20\x20npmjs:\n\
\x20\x20\x20\x20url: https://registry.npmjs.org/\n\
packages:\n\
\x20\x20'**':\n\
\x20\x20\x20\x20access: $all\n\
\x20\x20\x20\x20publish: $all\n\
\x20\x20\x20\x20unpublish: $all\n\
\x20\x20\x20\x20proxy: npmjs\n\
log: {{ type: stdout, format: pretty, level: warn }}\n"
    );

    let config_path = verdaccio_dir.join("config.yaml");
    std::fs::write(&config_path, config)?;
    Ok(config_path)
}

#[tauri::command]#[specta::specta]

pub async fn start_registry(port: Option<u16>, app: tauri::AppHandle) -> Result<String, String> {
    let state = app.state::<AppState>();

    let registry_config = state
        .persistent
        .lock_safe()
        .config
        .clone()
        .unwrap_or_default()
        .registry;
    let registry_port = port.unwrap_or(registry_config.port);

    // Check if verdaccio is installed
    let mut check_cmd = tokio::process::Command::new(cmd_name("verdaccio"));
    check_cmd.arg("--version");
    sanitize_command_env(&mut check_cmd);
    let check = check_cmd.output().await;

    if check.is_err() {
        return Err("Verdaccio is not installed. Run: npm install -g verdaccio".to_string());
    }

    // Start verdaccio
    let listen_arg = format!("127.0.0.1:{}", registry_port);
    crate::utils::validation::validate_shell_arg(&listen_arg).map_err(|e| e.to_string())?;

    if std::net::TcpListener::bind(&listen_arg).is_err() {
        return Err(format!("Port {} is already in use by another process.", registry_port));
    }

    let data_dir = state
        .data_dir
        .lock_safe()
        .clone()
        .unwrap_or_else(|| std::env::temp_dir().join("PackagePilot"));
    let config_path = write_verdaccio_config(&data_dir, &registry_config.storage_path)
        .map_err(|e| format!("Failed to write registry config: {}", e))?;

    {
        let mut running = state.registry_running.lock_safe();
        if *running {
            return Ok("Registry already running".to_string());
        }
        *running = true;
    }

    let spawn_app = app.clone();
    tokio::spawn(async move {
        let app = spawn_app;
        let max_retries = 5;
        let mut retry_count = 0;

        loop {
            if retry_count >= max_retries {
                *app.state::<AppState>().registry_running.lock_safe() = false;
                app.state::<AppState>().add_log(
                    crate::state::app_state::LogLevel::Error,
                    "Registry failed after max retries".to_string(),
                    "Registry".to_string(),
                );
                // The frontend only learns about this state change if it's
                // listening - without this, a UI left open on the Registry
                // page keeps showing "Running" forever after every retry is
                // exhausted in the background.
                let _ = app.emit("registry-status-changed", RegistryStatus { running: false, pid: None });
                break;
            }

            {
                let state = app.state::<AppState>();
                if !*state.registry_running.lock_safe() {
                    break;
                }
            }

            let mut cmd = tokio::process::Command::new(cmd_name("verdaccio"));
            cmd.arg("--config").arg(&config_path).args(["--listen", &listen_arg]);
            sanitize_command_env(&mut cmd);
            crate::utils::process::command_in_new_group(&mut cmd);

            let mut child = match cmd.spawn() {
                Ok(c) => c,
                Err(_) => {
                    retry_count += 1;
                    tokio::time::sleep(std::time::Duration::from_secs(2u64.pow(retry_count.min(5)))).await;
                    continue;
                }
            };

            if let Some(pid) = child.id() {
                *app.state::<crate::state::app_state::RegistryState>().process_id.lock_safe() = Some(pid);
            }

            // Reset retry count once process successfully spawns
            retry_count = 0;

            loop {
                tokio::select! {
                    _ = child.wait() => {
                        *app.state::<crate::state::app_state::RegistryState>().process_id.lock_safe() = None;
                        break;
                    }
                    _ = tokio::time::sleep(std::time::Duration::from_millis(500)) => {
                        let state = app.state::<AppState>();
                        if !*state.registry_running.lock_safe() {
                            if let Some(pid) = child.id() {
                                let _ = crate::utils::process::kill_process_tree(pid);
                            }
                            *app.state::<crate::state::app_state::RegistryState>().process_id.lock_safe() = None;
                            return;
                        }
                    }
                }
            }

            retry_count += 1;
            tokio::time::sleep(std::time::Duration::from_secs(2u64.pow(retry_count.min(5)))).await;
        }
    });

    if !wait_for_registry_ready(registry_port, Duration::from_secs(10)).await {
        return Err(format!(
            "Verdaccio was launched but isn't responding on port {} yet. It may still be starting - check again in a moment.",
            registry_port
        ));
    }

    let pid = *app.state::<crate::state::app_state::RegistryState>().process_id.lock_safe();
    let _ = app.emit("registry-status-changed", RegistryStatus { running: true, pid });

    Ok(format!(
        "Registry started on http://localhost:{}",
        registry_port
    ))
}

#[tauri::command(async)]#[specta::specta]

pub fn stop_registry(state: State<'_, AppState>) -> Result<(), String> {
    *state.registry_running.lock_safe() = false;
    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize)]
struct PublisherCredentials {
    username: String,
    token: String,
}

/// Returns an npm auth token verdaccio will accept, provisioning one on
/// first use and persisting it to `<data_dir>/verdaccio/publisher.json` for
/// reuse. npm's CLI refuses to attempt `publish` with no auth token at all,
/// even against a registry configured to allow anonymous publish (verified
/// live against verdaccio 6.7.4: `$all`/`$anonymous` access rules make no
/// difference - the client-side ENEEDAUTH guard fires before any request
/// reaches the server). A one-time `PUT /-/user/org.couchdb.user:<name>` -
/// the same request `npm adduser` makes - registers a throwaway local
/// identity and returns a usable token.
///
/// A fresh random username avoids needing to handle "this user already
/// exists in verdaccio's htpasswd" as a distinct case: that only happens if
/// the credentials file is lost while the htpasswd file (which lives under
/// the same persisted storage_path) survives, and provisioning a new random
/// identity sidesteps it entirely rather than needing a re-login flow.
async fn get_or_provision_publish_token(data_dir: &Path, port: u16) -> Result<String, String> {
    let creds_path = data_dir.join("verdaccio").join("publisher.json");
    if let Ok(content) = std::fs::read_to_string(&creds_path) {
        if let Ok(creds) = serde_json::from_str::<PublisherCredentials>(&content) {
            return Ok(creds.token);
        }
    }

    let username = format!("packagepilot-{}", uuid::Uuid::new_v4());
    let password = uuid::Uuid::new_v4().to_string();

    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
        .await
        .map_err(|e| format!("Could not connect to registry on port {}: {}", port, e))?;

    let body = serde_json::json!({
        "name": username,
        "password": password,
        "email": format!("{}@localhost", username),
    })
    .to_string();
    let request = format!(
        "PUT /-/user/org.couchdb.user:{username} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {len}\r\nConnection: close\r\n\r\n{body}",
        username = username,
        port = port,
        len = body.len(),
        body = body
    );
    stream.write_all(request.as_bytes()).await.map_err(|e| e.to_string())?;

    let mut raw = Vec::new();
    stream.read_to_end(&mut raw).await.map_err(|e| e.to_string())?;
    let response = String::from_utf8_lossy(&raw);
    let response_body = response.split_once("\r\n\r\n").map(|(_, b)| b).unwrap_or("");

    let parsed: serde_json::Value = serde_json::from_str(response_body)
        .map_err(|e| format!("Failed to parse registry auth response: {}", e))?;
    let token = parsed
        .get("token")
        .and_then(|t| t.as_str())
        .ok_or_else(|| format!("Registry did not return an auth token: {}", response_body))?
        .to_string();

    if let Some(parent) = creds_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let creds = PublisherCredentials { username, token: token.clone() };
    if let Ok(json) = serde_json::to_string(&creds) {
        let tmp_path = creds_path.with_file_name("publisher.json.tmp");
        if std::fs::write(&tmp_path, &json).is_ok() {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(
                    &tmp_path,
                    std::fs::Permissions::from_mode(0o600),
                );
            }
            let _ = std::fs::rename(&tmp_path, &creds_path);
        }
    }

    Ok(token)
}

#[tauri::command]#[specta::specta]

pub async fn publish_to_registry(
    package_path: String,
    registry_url: Option<String>,
    dry_run: Option<bool>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let url = registry_url.unwrap_or_else(|| "http://localhost:4873".to_string());
    let port = extract_port(&url);

    let data_dir = state
        .data_dir
        .lock_safe()
        .clone()
        .unwrap_or_else(|| std::env::temp_dir().join("PackagePilot"));
    let token = get_or_provision_publish_token(&data_dir, port).await?;
    let auth_arg = format!("--//127.0.0.1:{}/:_authToken={}", port, token);

    let mut args = vec!["publish", "--registry", &url, &auth_arg];
    if dry_run.unwrap_or(false) {
        args.push("--dry-run");
    }

    let res = crate::services::shell::run_command(
        "npm",
        &args,
        &package_path,
        std::time::Duration::from_secs(600),
    )
    .await;

    res.map_err(|e| e.to_string())
}

/// Fetches verdaccio's `/-/all` endpoint - the standard npm-registry-protocol
/// "list every package" route - and returns the package names.
///
/// This used to shell out to `npm search --registry <url> --json` with no
/// search term, which npm rejects outright ("search must be called with
/// arguments") - verified live against a real verdaccio instance, it can
/// never succeed. `/-/all` is a plain unauthenticated GET returning a JSON
/// object of `{ package_name: metadata, ..., "_updated": <timestamp> }`,
/// confirmed against verdaccio 6.7.4.
/// Decodes an HTTP/1.1 chunked-transfer-encoded body. verdaccio serves
/// `/-/all` with `Transfer-Encoding: chunked` (confirmed live against
/// verdaccio 6.7.4), so the raw body is interleaved with hex chunk-size
/// lines and CRLF terminators - passing it straight to a JSON parser fails
/// with a trailing-characters error once the chunk-0 terminator is hit.
fn dechunk(mut body: &[u8]) -> Vec<u8> {
    let mut result = Vec::new();
    while let Some(line_end) = body.windows(2).position(|w| w == b"\r\n") {
        let (size_line, rest) = body.split_at(line_end);
        let rest = &rest[2..];
        let Ok(size) = usize::from_str_radix(std::str::from_utf8(size_line).unwrap_or("").trim(), 16)
        else {
            break;
        };
        if size == 0 || rest.len() < size {
            break;
        }
        result.extend_from_slice(&rest[..size]);
        body = rest[size..].strip_prefix(b"\r\n").unwrap_or(&rest[size..]);
    }
    result
}

async fn fetch_all_packages(port: u16) -> Result<Vec<String>, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
        .await
        .map_err(|e| format!("Could not connect to registry on port {}: {}", port, e))?;

    let request = format!(
        "GET /-/all HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
        port
    );
    stream
        .write_all(request.as_bytes())
        .await
        .map_err(|e| e.to_string())?;

    let mut raw = Vec::new();
    stream.read_to_end(&mut raw).await.map_err(|e| e.to_string())?;

    let split_at = raw
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or_else(|| "Malformed response from registry".to_string())?;
    let (headers, body) = raw.split_at(split_at);
    let body = &body[4..];

    let headers_lower = String::from_utf8_lossy(headers).to_lowercase();
    let body_bytes = if headers_lower.contains("transfer-encoding: chunked") {
        dechunk(body)
    } else {
        body.to_vec()
    };

    let parsed: serde_json::Value = serde_json::from_slice(&body_bytes)
        .map_err(|e| format!("Failed to parse registry response: {}", e))?;

    let names = parsed
        .as_object()
        .map(|obj| {
            obj.keys()
                .filter(|k| k.as_str() != "_updated")
                .cloned()
                .collect()
        })
        .unwrap_or_default();

    Ok(names)
}

#[tauri::command]#[specta::specta]

pub async fn list_registry_packages(registry_url: Option<String>) -> Result<Vec<String>, String> {
    let url = registry_url.unwrap_or_else(|| "http://localhost:4873".to_string());
    fetch_all_packages(extract_port(&url)).await
}

#[derive(Clone, serde::Serialize, specta::Type)]
pub struct RegistryStatus {
    pub running: bool,
    pub pid: Option<u32>,
}

#[tauri::command]#[specta::specta]

pub fn get_registry_status(
    state: State<'_, AppState>,
    registry_state: State<'_, crate::state::app_state::RegistryState>,
) -> Result<RegistryStatus, String> {
    let running = *state.registry_running.lock_safe();
    let pid = *registry_state.process_id.lock_safe();
    Ok(RegistryStatus { running, pid })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn wait_for_registry_ready_returns_true_once_something_is_listening() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        // Accept in the background so the connect the poller makes doesn't
        // just sit in the OS backlog untouched.
        std::thread::spawn(move || {
            let _ = listener.accept();
        });

        let ready = wait_for_registry_ready(port, Duration::from_secs(3)).await;
        assert!(ready);
    }

    #[tokio::test]
    async fn wait_for_registry_ready_times_out_when_nothing_is_listening() {
        // Grab an ephemeral port and then immediately drop the listener, so
        // nothing is bound to it for the duration of the poll.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);

        let ready = wait_for_registry_ready(port, Duration::from_millis(500)).await;
        assert!(!ready);
    }

    #[test]
    fn sanitize_command_env_strips_secrets_but_keeps_path() {
        std::env::set_var("NPM_TOKEN", "super_secret_value");

        let mut cmd = tokio::process::Command::new("does-not-matter");
        sanitize_command_env(&mut cmd);

        let std_cmd: &std::process::Command = cmd.as_std();
        let envs: std::collections::HashMap<_, _> = std_cmd.get_envs().collect();

        assert!(
            !envs.contains_key(std::ffi::OsStr::new("NPM_TOKEN")),
            "secret env vars must not reach the verdaccio process"
        );
        assert!(
            envs.contains_key(std::ffi::OsStr::new("PATH")),
            "PATH must survive sanitization or verdaccio can't resolve node/npm"
        );

        std::env::remove_var("NPM_TOKEN");
    }

    #[test]
    fn dechunk_decodes_a_single_chunk_body() {
        // Same shape verdaccio 6.7.4 sent live for `/-/all` with an empty
        // registry: one chunk (size prefix must match the byte count
        // exactly - 0x12 = 18, the length of the JSON below), then the
        // zero-length terminator.
        let raw = b"12\r\n{\"_updated\":99999}\r\n0\r\n\r\n";
        assert_eq!(dechunk(raw), b"{\"_updated\":99999}");
    }

    #[test]
    fn dechunk_decodes_multiple_chunks() {
        let raw = b"5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n";
        assert_eq!(dechunk(raw), b"hello world");
    }

    #[test]
    fn dechunk_returns_empty_for_a_zero_length_body() {
        let raw = b"0\r\n\r\n";
        assert_eq!(dechunk(raw), b"");
    }

    struct TestTempDir {
        path: PathBuf,
    }

    impl TestTempDir {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir()
                .join(format!("packagepilot_registry_test_{}_{}", name, uuid::Uuid::new_v4()));
            let _ = std::fs::create_dir_all(&path);
            TestTempDir { path }
        }
    }

    impl Drop for TestTempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn write_verdaccio_config_resolves_relative_storage_path_against_data_dir() {
        let data_dir = TestTempDir::new("relative");

        let config_path = write_verdaccio_config(&data_dir.path, "./local-registry").unwrap();

        let expected_storage = data_dir.path.join("local-registry");
        assert!(expected_storage.is_dir(), "storage dir should be created");

        let contents = std::fs::read_to_string(&config_path).unwrap();
        let expected_storage_yaml = expected_storage.to_string_lossy().replace('\\', "/");
        assert!(
            contents.contains(&format!("storage: {}", expected_storage_yaml)),
            "config should point at the resolved storage path, got: {}",
            contents
        );
    }

    #[test]
    fn write_verdaccio_config_keeps_absolute_storage_path_as_is() {
        let data_dir = TestTempDir::new("absolute_data");
        let storage_dir = TestTempDir::new("absolute_storage");

        let config_path =
            write_verdaccio_config(&data_dir.path, &storage_dir.path.to_string_lossy()).unwrap();

        let contents = std::fs::read_to_string(&config_path).unwrap();
        let expected_storage_yaml = storage_dir.path.to_string_lossy().replace('\\', "/");
        assert!(
            contents.contains(&format!("storage: {}", expected_storage_yaml)),
            "config should keep the absolute storage path unchanged, got: {}",
            contents
        );
    }

    #[test]
    fn write_verdaccio_config_writes_into_a_verdaccio_subdir_of_data_dir() {
        let data_dir = TestTempDir::new("subdir");

        let config_path = write_verdaccio_config(&data_dir.path, "./local-registry").unwrap();

        assert_eq!(config_path, data_dir.path.join("verdaccio").join("config.yaml"));
        assert!(config_path.is_file());
    }
}
