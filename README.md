# Package Pilot

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
[![CI](https://github.com/nextbridgehq/package-pilot/actions/workflows/ci.yml/badge.svg)](https://github.com/nextbridgehq/package-pilot/actions/workflows/ci.yml)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)
![Tech Stack](https://img.shields.io/badge/tech-Tauri%20%7C%20React%20%7C%20TypeScript-blueviolet.svg)

[GitHub](https://github.com/nextbridgehq/package-pilot) · [Issues](https://github.com/nextbridgehq/package-pilot/issues) · [Releases](https://github.com/nextbridgehq/package-pilot/releases) · [Changelog](CHANGELOG.md)

Maintained by [Nextbridge](https://nextbridge.com)

---

## The Problem It Solves

Package Pilot replaces manual, error-prone terminal commands with a clean GUI for local package linking and testing. Before publishing your Node.js libraries, test them locally with confidence in a sandboxed environment.

## Key Features

- **Project Management:** Add projects, scan for packages automatically, filter by CLI packages
- **Package Discovery:** Browse all packages across projects with dependency details, versions, and package manager detection
- **Multiple Linking Strategies:**
  - **Symlink (npm link)** — Fast symbolic linking via npm
  - **Yalc** — Local publish/install with best balance of speed and reliability
  - **npm pack** — Creates a tarball and installs it for realistic simulation
  - **Workspace (file:)** — Adds file: reference in package.json for monorepos
  - **File Copy** — Directly copies files to node_modules
- **Package Selection:** Searchable dropdown grouped by project for quick package selection
- **Automated Sandboxes:** Instantly create isolated environments for testing CLI packages
- **Built-in Terminal:** Integrated xterm.js terminal with PTY support and command persistence
- **Live Watcher:** Automatically run build scripts when your source code changes
- **File Change Events:** Real-time file system monitoring with event type detection (Created, Modified, Deleted)
- **System Doctor:** Diagnose symlink permissions, Node.js installation, and environment setup
- **Activity Logs:** Real-time log stream from all backend operations with filtering and search
- **Settings:** Configurable default package manager, auto-build, auto-install peer deps, watcher debounce, theme
- **Dashboard:** Overview of projects, packages, active links, and watchers with quick actions

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/)
- [Rust](https://www.rust-lang.org/) (for Tauri backend)
- Optional: [Yalc](https://github.com/wix-incubator/yalc) for Yalc linking method

### Installation

Clone the repository and install the dependencies:

```bash
npm install
```

### Running the App

Start the application in development mode:

```bash
npm run tauri dev
```

### Building for Production

```bash
npm run tauri build
```

## Tech Stack

- **Backend:** [Tauri](https://tauri.app/) (Rust)
- **Frontend:** React with [Fluent UI](https://react.fluentui.dev/)
- **State Management:** Zustand
- **Terminal:** xterm.js with PTY integration
- **Build Tool:** Vite & TypeScript

## Documentation

- [Deployment guide](docs/DEPLOYMENT.md) — building `.deb` packages for Ubuntu/Linux
- [Security policy](SECURITY.md) — supported versions, vulnerability reporting, and sandboxing notes
- [Changelog](CHANGELOG.md) — notable changes across releases

## License

[MIT](LICENSE) © [Nextbridge](https://www.nextbridge.com)

Built and maintained by **[Nextbridge](https://nextbridge.com)** — If Package Pilot spared you the usual terminal trial-and-error before publishing, a ⭐ would mean a lot — it helps other deveopers find a better way too.
