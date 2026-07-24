# Ubuntu Deployment Guide

To provide a `.deb` file for Ubuntu users, you can use the built-in Tauri bundler.

Tauri is already configured to build a `.deb` package automatically when compiled on a Debian-based Linux system (like Ubuntu).

## Option 1: Build Locally on Ubuntu
If you have an Ubuntu machine or a Linux VM:

1. Install the required system dependencies:
   ```bash
   sudo apt update
   sudo apt install libwebkit2gtk-4.1-dev \
     build-essential \
     curl \
     wget \
     file \
     libxdo-dev \
     libssl-dev \
     libayatana-appindicator3-dev \
     librsvg2-dev
   ```
2. Clone the repository and install dependencies:
   ```bash
   npm install
   ```
3. Run the Tauri build command:
   ```bash
   npm run tauri build
   ```
4. The `.deb` file will be generated in `src-tauri/target/release/bundle/deb/`.

## Option 2: Automate with GitHub Actions
The project's existing `.github/workflows/ci.yml` only builds and tests on `windows-latest`, and only triggers on pushes/PRs to `main` — it does not build a `.deb` or run on releases. To get a `.deb` attached to a GitHub Release automatically, add a **separate** workflow file (e.g. `.github/workflows/release.yml`) rather than editing `ci.yml`, since it needs a different trigger (`release`, not `push`/`pull_request`):

```yaml
name: Release Ubuntu Build

on:
  release:
    types: [created]

jobs:
  build-ubuntu:
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v4

      - name: Install dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf

      - name: Install Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install Rust
        uses: dtolnay/rust-toolchain@stable

      - name: Install npm dependencies
        run: npm ci

      - name: Build Tauri
        run: npm run tauri build

      - name: Attach .deb to Release
        uses: softprops/action-gh-release@v2
        with:
          files: src-tauri/target/release/bundle/deb/*.deb
```

Note: `actions/upload-artifact` (used in some Tauri examples) only stores the file as a downloadable CI run artifact — it does **not** attach it to the GitHub Release itself. `softprops/action-gh-release` does the actual attachment described above.

---

[← Back to README](../README.md)
