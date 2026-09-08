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

The repository includes a dedicated cross-platform release workflow [`.github/workflows/release.yml`](../.github/workflows/release.yml) that builds and publishes release packages for Windows (`.msi`, `.exe`), macOS (`.dmg`), and Ubuntu Linux (`.deb`, `.AppImage`).

The release workflow triggers automatically on:
- Pushing a version tag (e.g. `v1.2.0`):
  ```bash
  git tag v1.2.0
  git push origin v1.2.0
  ```
- Manual execution via GitHub Actions **Run workflow** (`workflow_dispatch`).

### Linux Runner Dependencies
For Ubuntu runners (including Ubuntu 24.04 Noble), the workflow installs:
```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf
```
Tauri's official action (`tauri-apps/tauri-action`) then builds the `.deb` and `.AppImage` packages and uploads them to the GitHub Release.

---

[← Back to README](../README.md)
