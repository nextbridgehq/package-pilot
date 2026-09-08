# Changelog

All notable changes to Package Pilot are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-09-08

### Fixed

- Fix Windows WebView2 startup crash (`0x80070057: The parameter is incorrect`) caused by premature focus during window initialization
- Fix GitHub Actions Linux release workflow failure on Ubuntu 24.04 (`libwebkit2gtk-4.1-dev` and `libayatana-appindicator3-dev`)
- Fix missing Tauri ACL permission for `get_directory_sizes` in production capability manifests
- Fix Dagre layout node accumulation leak across project switches in Dependency Topology view
- Optimize directory size IPC in Dependency Topology view to single batch query
- Suppress noisy IPC error logs when auto-updater plugin is uninitialized
- Ensure application log entries trigger state persistence on exit and timer cycles

## [1.1.0] - 2026-08-13

### Added

- Bun support alongside npm/pnpm/yarn with 4-tier package manager resolution
- Local npm registry (Verdaccio) with start/stop, publish, browse, and configurable settings
- Lifecycle script security analyzer with categorized threat findings
- Security audit for standalone packages and monorepo workspaces
- Sandbox creation and CLI smoke-testing for any linked package
- Dependency topology map with cyclic-dependency detection and directory size footprints
- Workspace task orchestration for Turborepo and Lerna monorepos
- Local analytics dashboard tracking project metrics over time
- Interactive terminal multiplexer with tabbed sessions, resizable docked panel, and PowerShell theming
- Auto-updater with in-app update banner
- Cross-platform CI/CD release workflow
- Copy button for security audit results
- macOS and Linux fallbacks for the `open_terminal` command

### Fixed

- Fix registry package listing and publish
- Fix terminal UI
- Fix PTY and watcher processes
- Fix CI: resolve Vitest worker timeouts on Windows runners

## [1.0.0] 2026-07-24

- Initial public release of Package Pilot. See the [feature overview](README.md#key-features).

[1.2.0]: https://github.com/nextbridgehq/package-pilot/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/nextbridgehq/package-pilot/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/nextbridgehq/package-pilot/releases/tag/v1.0.0
